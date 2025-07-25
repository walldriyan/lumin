
'use client';

import React, { useMemo } from 'react';
import type { ComprehensiveReport, SaleRecord, FinancialTransaction, StockAdjustmentLog } from '@/types';
import { Prisma } from '@prisma/client';
import { Badge } from '@/components/ui/badge';

interface ReportPrintLayoutProps {
  data: ComprehensiveReport;
}

export function ReportPrintLayout({ data }: ReportPrintLayoutProps) {
  const { summary, sales, returns, financialTransactions, stockAdjustments, purchases, cashRegisterShifts, newOrUpdatedProducts, newOrUpdatedParties, startDate, endDate, generatedAt } = data;
  
  const salesTransactionGroups = useMemo(() => {
    if (!data) return [];
    
    const grouped = new Map<string, { original: SaleRecord; adjusted: SaleRecord | null; returns: SaleRecord[] }>();

    data.sales.forEach(sale => {
      if (sale.status === 'COMPLETED_ORIGINAL') {
        grouped.set(sale.billNumber, { original: sale, adjusted: null, returns: [] });
      }
    });

    data.sales.forEach(sale => {
      if (sale.status === 'ADJUSTED_ACTIVE' && sale.originalSaleRecordId) {
        const original = data.sales.find(s => s.id === sale.originalSaleRecordId);
        if (original && grouped.has(original.billNumber)) {
          const existing = grouped.get(original.billNumber)!;
          if (!existing.adjusted || new Date(sale.date) > new Date(existing.adjusted.date)) {
            existing.adjusted = sale;
          }
        }
      }
    });

    data.returns.forEach(ret => {
      const original = data.sales.find(s => s.id === ret.originalSaleRecordId);
      if (original && grouped.has(original.billNumber)) {
        grouped.get(original.billNumber)!.returns.push(ret);
      }
    });

    return Array.from(grouped.values()).sort((a,b) => new Date(b.original.date).getTime() - new Date(a.original.date).getTime());
  }, [data]);

  return (
    <div>
      <h1>Comprehensive Report</h1>
      <p><strong>Report Period:</strong> {new Date(startDate).toLocaleDateString()} to {new Date(endDate).toLocaleDateString()}</p>
      <p><strong>Generated On:</strong> {new Date(generatedAt).toLocaleString()}</p>

      <h2>Profit &amp; Loss Summary</h2>
      <table style={{ width: '100%', border: 'none', borderSpacing: '10px 0', marginBottom: '20px' }}>
        <tbody>
          <tr style={{ verticalAlign: 'top' }}>
            <td style={{ width: '50%', padding: 0, border: 'none' }}>
              <table style={{ width: '100%', border: '1px solid #ddd' }}>
                <thead>
                  <tr style={{ backgroundColor: '#e8f5e9' }}>
                    <th colSpan={2} style={{ textAlign: 'left', padding: '8px' }}>Income / Gains</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Net Sales (from Active Bills)</td><td style={{ textAlign: 'right' }}>Rs. {summary.netSales.toFixed(2)}</td></tr>
                  <tr><td>Other Income</td><td style={{ textAlign: 'right' }}>Rs. {summary.totalIncome.toFixed(2)}</td></tr>
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #ccc' }}>
                    <td><strong>Total Income / Gains</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>Rs. {(summary.netSales + summary.totalIncome).toFixed(2)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </td>
            <td style={{ width: '50%', padding: 0, paddingLeft: '20px', border: 'none' }}>
              <table style={{ width: '100%', border: '1px solid #ddd' }}>
                <thead>
                  <tr style={{ backgroundColor: '#ffebee' }}>
                    <th colSpan={2} style={{ textAlign: 'left', padding: '8px' }}>Expenses &amp; Outflows</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>Payments to Suppliers</td><td style={{ textAlign: 'right' }}>Rs. {summary.totalPaymentsToSuppliers.toFixed(2)}</td></tr>
                  <tr><td>Other Expenses</td><td style={{ textAlign: 'right' }}>Rs. {summary.totalExpense.toFixed(2)}</td></tr>
                  <tr><td>Stock Loss Value (Non-Cash)</td><td style={{ textAlign: 'right' }}>Rs. {summary.totalStockAdjustmentsValue.toFixed(2)}</td></tr>
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid #ccc' }}>
                    <td><strong>Total Expenses &amp; Outflows</strong></td>
                    <td style={{ textAlign: 'right' }}><strong>Rs. {(summary.totalPaymentsToSuppliers + summary.totalExpense + summary.totalStockAdjustmentsValue).toFixed(2)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="final-summary">
        <div className="row">
          <strong>NET PROFIT / LOSS:</strong>
          <strong style={{ color: summary.netProfitLoss >= 0 ? 'green' : 'red' }}>Rs. {summary.netProfitLoss.toFixed(2)}</strong>
        </div>
      </div>

      <h3>Sales &amp; Inventory Metrics</h3>
      <table style={{ width: '100%', border: 'none', borderSpacing: '10px 0', marginBottom: '20px' }}>
         <tbody>
            <tr style={{ verticalAlign: 'top' }}>
               <td style={{ width: '50%', padding: 0, border: 'none' }}>
                 <table style={{ width: '100%', border: '1px solid #ddd' }}>
                    <thead><tr><th colSpan={2} style={{textAlign: 'left', padding: '8px'}}>Sales Analysis</th></tr></thead>
                    <tbody>
                        <tr><td>Gross Sales</td><td style={{textAlign: 'right'}}>Rs. {summary.grossSales.toFixed(2)}</td></tr>
                        <tr><td>Discounts Given</td><td style={{textAlign: 'right', color: 'red'}}>- Rs. {summary.totalDiscounts.toFixed(2)}</td></tr>
                        <tr style={{fontWeight: 'bold', borderTop: '1px solid #ccc'}}><td>Net Sales</td><td style={{textAlign: 'right'}}>Rs. {summary.netSales.toFixed(2)}</td></tr>
                    </tbody>
                 </table>
               </td>
                <td style={{ width: '50%', padding: 0, paddingLeft: '20px', border: 'none' }}>
                  <table style={{ width: '100%', border: '1px solid #ddd' }}>
                    <thead><tr><th colSpan={2} style={{textAlign: 'left', padding: '8px'}}>Inventory Cost Analysis</th></tr></thead>
                    <tbody>
                        <tr><td>Cost of Goods Sold (COGS)</td><td style={{textAlign: 'right'}}>Rs. {summary.costOfGoodsSold.toFixed(2)}</td></tr>
                        <tr><td>Stock Loss Value</td><td style={{textAlign: 'right'}}>Rs. {summary.totalStockAdjustmentsValue.toFixed(2)}</td></tr>
                    </tbody>
                 </table>
               </td>
            </tr>
         </tbody>
      </table>


      <h3>Sales &amp; Returns Transactions ({salesTransactionGroups.length} original bills)</h3>
      {salesTransactionGroups.length > 0 ? salesTransactionGroups.map(group => {
        const activeBill = group.adjusted || group.original;
        const originalIsSuperseded = !!group.adjusted;
        const totalDiscount = (activeBill.totalItemDiscountAmount || 0) + (activeBill.totalCartDiscountAmount || 0);
        const totalItems = (activeBill.items as any[])?.reduce((sum, item) => sum + item.quantity, 0);

        return (
            <div key={`print-group-${group.original.id}`} style={{ border: '1px solid #ddd', borderRadius: '5px', padding: '10px', marginBottom: '15px' }}>
                <h4>Transaction Group: {group.original.billNumber}</h4>
                <table style={{ marginBottom: 0 }}>
                    <thead>
                        <tr><th>Date</th><th>Bill No</th><th>User</th><th>Details</th><th>Amount</th></tr>
                    </thead>
                    <tbody>
                        <tr style={{ backgroundColor: '#e8f5e9', fontWeight: 'bold' }}>
                            <td>{new Date(activeBill.date).toLocaleString()}</td>
                            <td>{activeBill.billNumber}</td>
                            <td>{activeBill.createdBy?.username || 'N/A'}</td>
                            <td>
                                Active Bill: {totalItems} units in {(activeBill.items as any[])?.length || 0} items
                                {totalDiscount > 0 && 
                                    <span> | Disc: Rs. {totalDiscount.toFixed(2)}</span>
                                }
                                <span> | by {activeBill.paymentMethod}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>Rs. {activeBill.totalAmount.toFixed(2)}</td>
                        </tr>
                        {originalIsSuperseded && (
                            <tr style={{ backgroundColor: '#fafafa', color: '#666', textDecoration: 'line-through' }}>
                                <td>{new Date(group.original.date).toLocaleString()}</td>
                                <td>{group.original.billNumber}</td>
                                <td>{group.original.createdBy?.username || 'N/A'}</td>
                                <td>Original (Superseded): {(group.original.items as any[])?.length || 0} items</td>
                                <td style={{ textAlign: 'right' }}>Rs. {group.original.totalAmount.toFixed(2)}</td>
                            </tr>
                        )}
                        {group.returns.map(ret => {
                             const totalQtyReturned = (ret.items as any[]).reduce((sum, item) => sum + item.quantity, 0);
                             return (
                            <tr key={`print-ret-${ret.id}`} style={{ backgroundColor: '#fff5f5' }}>
                                <td style={{ paddingLeft: '20px' }}>{new Date(ret.date).toLocaleString()}</td>
                                <td>&#8627; {ret.billNumber}</td>
                                <td>{ret.createdBy?.username || 'N/A'}</td>
                                <td>Return: {totalQtyReturned} units</td>
                                <td style={{ textAlign: 'right', color: 'red' }}>-Rs. {ret.totalAmount.toFixed(2)}</td>
                            </tr>
                        )})}
                    </tbody>
                </table>
            </div>
        );
      }) : <p>No sales in this period.</p>}
      <table style={{ marginTop: '10px' }}>
        <tfoot>
            <tr>
                <td colSpan={4} style={{ textAlign: 'right', fontWeight: 'bold' }}>Net Sales from Active Bills:</td>
                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>Rs. {summary.netSales.toFixed(2)}</td>
            </tr>
        </tfoot>
      </table>
      
      <h3>Purchases ({purchases.length})</h3>
      <table>
        <thead><tr><th>Date</th><th>User</th><th>Supplier Bill</th><th>Supplier</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
            {purchases.length > 0 ? purchases.map(p => (
            <tr key={p.id}>
                <td>{new Date(p.purchaseDate).toLocaleDateString()}</td>
                <td>{p.createdBy?.username || 'N/A'}</td>
                <td>{p.supplierBillNumber}</td>
                <td>{p.supplier?.name}</td>
                <td style={{textAlign:'right'}}>Rs. {p.totalAmount.toFixed(2)}</td>
                <td>{p.paymentStatus}</td>
            </tr>
            )) : <tr><td colSpan={6}>No purchases in this period.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5} style={{textAlign:'right', fontWeight:'bold'}}>Total Purchases:</td><td style={{textAlign:'right', fontWeight:'bold'}}>Rs. {summary.totalPurchaseValue.toFixed(2)}</td></tr></tfoot>
      </table>

      <h3>Financial Transactions ({financialTransactions.length})</h3>
       <table>
        <thead><tr><th>Date</th><th>User</th><th>Type</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          {financialTransactions.length > 0 ? financialTransactions.map(tx => (
            <tr key={tx.id}>
              <td>{new Date(tx.date).toLocaleDateString()}</td>
              <td>{tx.user?.username || 'N/A'}</td>
              <td style={{color: tx.type === 'INCOME' ? 'green' : 'red'}}>{tx.type}</td>
              <td>{tx.category}</td>
              <td>{tx.description || 'N/A'}</td>
              <td style={{textAlign:'right'}}>Rs. {tx.amount.toFixed(2)}</td>
            </tr>
          )) : <tr><td colSpan={6}>No financial transactions in this period.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={4} style={{textAlign:'right', fontWeight:'bold'}}>Total Other Income/Expense:</td><td style={{textAlign:'right', fontWeight:'bold', color: 'green'}}>+Rs. {summary.totalIncome.toFixed(2)}</td><td style={{textAlign:'right', fontWeight:'bold', color: 'red'}}>-Rs. {summary.totalExpense.toFixed(2)}</td></tr></tfoot>
      </table>

      <h3>Stock Adjustments ({stockAdjustments.length})</h3>
       <table>
        <thead><tr><th>Date</th><th>User</th><th>Product</th><th>Reason</th><th>Quantity Changed</th><th>Notes</th></tr></thead>
        <tbody>
          {stockAdjustments.length > 0 ? stockAdjustments.map(adj => (
            <tr key={adj.id}>
              <td>{new Date(adj.adjustedAt).toLocaleString()}</td>
              <td>{adj.user?.username || 'N/A'}</td>
              <td>{adj.product.name}</td>
              <td>{adj.reason}</td>
              <td style={{textAlign:'right', color: adj.quantityChanged > 0 ? 'green' : 'red'}}>{adj.quantityChanged}</td>
              <td>{adj.notes || 'N/A'}</td>
            </tr>
          )): <tr><td colSpan={6}>No stock adjustments in this period.</td></tr>}
        </tbody>
        <tfoot><tr><td colSpan={5} style={{textAlign:'right', fontWeight:'bold'}}>Total Stock Loss Value:</td><td style={{textAlign:'right', fontWeight:'bold', color: 'red'}}>Rs. {summary.totalStockAdjustmentsValue.toFixed(2)}</td></tr></tfoot>
      </table>

       <h3>Cash Register Shifts ({cashRegisterShifts.length})</h3>
       <table>
         <thead><tr><th>User</th><th>Started</th><th>Closed</th><th>Opening</th><th>Closing</th><th>Net</th></tr></thead>
         <tbody>
           {cashRegisterShifts.length > 0 ? cashRegisterShifts.map(s => {
             const net = s.closingBalance ? s.closingBalance - s.openingBalance : null;
             return (
               <tr key={s.id}>
                 <td>{s.user?.username}</td>
                 <td>{new Date(s.startedAt).toLocaleString()}</td>
                 <td>{s.closedAt ? new Date(s.closedAt).toLocaleString() : "OPEN"}</td>
                 <td style={{textAlign:'right'}}>Rs. {s.openingBalance.toFixed(2)}</td>
                 <td style={{textAlign:'right'}}>{s.closingBalance ? `Rs. ${s.closingBalance.toFixed(2)}` : 'N/A'}</td>
                 <td style={{textAlign:'right', color: net === null ? '' : (net >= 0 ? 'green' : 'red')}}>{net !== null ? `Rs. ${net.toFixed(2)}` : 'N/A'}</td>
               </tr>
             )
           }) : <tr><td colSpan={6}>No cash register shifts in this period.</td></tr>}
         </tbody>
         <tfoot><tr><td colSpan={5} style={{textAlign:'right', fontWeight:'bold'}}>Net Cash Change:</td><td style={{textAlign:'right', fontWeight:'bold'}}>Rs. {summary.netCashFromShifts.toFixed(2)}</td></tr></tfoot>
       </table>

       <h3>Product Updates ({newOrUpdatedProducts.length})</h3>
       <table>
         <thead><tr><th>Name</th><th>Category</th><th>Updated At</th></tr></thead>
         <tbody>
           {newOrUpdatedProducts.length > 0 ? newOrUpdatedProducts.map(p => (
             <tr key={`prod-print-${p.id}`}>
               <td>{p.name}</td>
               <td>{p.category}</td>
               <td>{new Date(p.updatedAt!).toLocaleString()}</td>
             </tr>
           )) : <tr><td colSpan={3}>No products updated in this period.</td></tr>}
         </tbody>
       </table>
       
       <h3>Contact Updates ({newOrUpdatedParties.length})</h3>
       <table>
         <thead><tr><th>Name</th><th>Type</th><th>Updated At</th></tr></thead>
         <tbody>
           {newOrUpdatedParties.length > 0 ? newOrUpdatedParties.map(p => (
             <tr key={`party-print-${p.id}`}>
               <td>{p.name}</td>
               <td>{p.type}</td>
               <td>{new Date(p.updatedAt!).toLocaleString()}</td>
             </tr>
           )) : <tr><td colSpan={3}>No contacts updated in this period.</td></tr>}
         </tbody>
       </table>
    </div>
  );
}
