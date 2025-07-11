
'use server';

import prisma from '@/lib/prisma';
import type { ComprehensiveReport, SaleRecord, FinancialTransaction, StockAdjustmentLog, PurchaseBill, CashRegisterShift, Product, Party, User } from '@/types';
import { Prisma } from '@prisma/client';

export async function getComprehensiveReportAction(
  startDate: Date,
  endDate: Date,
  userId?: string | null
): Promise<{ success: boolean; data?: ComprehensiveReport; error?: string }> {
  try {
    const userFilterForSales = userId ? { createdByUserId: userId } : {};
    const userFilterForFinancials = userId ? { userId: userId } : {};
    const userFilterForStock = userId ? { userId: userId } : {};
    const userFilterForPurchases = userId ? { createdByUserId: userId } : {};
    const userFilterForProductsAndParties = userId ? { updatedByUserId: userId } : {};

    // 1. Fetch all necessary data with user details included
    const salesAndReturns = await prisma.saleRecord.findMany({
      where: { date: { gte: startDate, lte: endDate }, ...userFilterForSales },
      include: { customer: true, createdBy: { select: { username: true } } },
      orderBy: { date: 'asc' },
    });
    const financialTransactions = await prisma.financialTransaction.findMany({ 
        where: { date: { gte: startDate, lte: endDate }, ...userFilterForFinancials }, 
        include: { user: { select: { username: true } } },
        orderBy: { date: 'asc' } 
    });
    const stockAdjustments = await prisma.stockAdjustmentLog.findMany({ 
        where: { adjustedAt: { gte: startDate, lte: endDate }, ...userFilterForStock }, 
        include: { product: { select: { name: true } }, user: { select: { username: true } } }, 
        orderBy: { adjustedAt: 'asc' } 
    });
    const purchases = await prisma.purchaseBill.findMany({ 
        where: { purchaseDate: { gte: startDate, lte: endDate }, ...userFilterForPurchases }, 
        include: { supplier: true, items: true, payments: true, createdBy: { select: { username: true } } } 
    });
    const cashRegisterShifts = await prisma.cashRegisterShift.findMany({ 
        where: { startedAt: { lte: endDate }, OR: [{ closedAt: null }, { closedAt: { gte: startDate }}], ...userFilterForFinancials }, 
        include: { user: { select: { username: true } } } 
    });
    const newOrUpdatedProducts = await prisma.product.findMany({ where: { updatedAt: { gte: startDate, lte: endDate }, ...userFilterForProductsAndParties } });
    const newOrUpdatedParties = await prisma.party.findMany({ where: { updatedAt: { gte: startDate, lte: endDate }, ...userFilterForProductsAndParties } });

    const allSales = salesAndReturns.filter(r => r.recordType === 'SALE').map(s => ({...s, items: s.items as Prisma.JsonArray, returnedItemsLog: s.returnedItemsLog as Prisma.JsonArray, appliedDiscountSummary: s.appliedDiscountSummary as Prisma.JsonArray}) as any);
    const allReturns = salesAndReturns.filter(r => r.recordType === 'RETURN_TRANSACTION').map(s => ({...s, items: s.items as Prisma.JsonArray, returnedItemsLog: s.returnedItemsLog as Prisma.JsonArray, appliedDiscountSummary: s.appliedDiscountSummary as Prisma.JsonArray}) as any);


    // --- Identify Active Sale Records for Summary ---
    const salesByBillNumber = new Map<string, { original: SaleRecord; adjusted: SaleRecord[] }>();
    allSales.forEach(sale => {
      if (sale.status === 'COMPLETED_ORIGINAL') {
        salesByBillNumber.set(sale.billNumber, { original: sale, adjusted: [] });
      }
    });
    allSales.forEach(sale => {
      if (sale.status === 'ADJUSTED_ACTIVE' && sale.originalSaleRecordId) {
        const originalSale = allSales.find(os => os.id === sale.originalSaleRecordId);
        if (originalSale && salesByBillNumber.has(originalSale.billNumber)) {
          salesByBillNumber.get(originalSale.billNumber)!.adjusted.push(sale);
        }
      }
    });

    const activeSaleRecords: SaleRecord[] = [];
    salesByBillNumber.forEach(group => {
      if (group.adjusted.length > 0) {
        const latestAdjusted = group.adjusted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        activeSaleRecords.push(latestAdjusted);
      } else {
        activeSaleRecords.push(group.original);
      }
    });

    // --- Calculate Summary based on ACTIVE bills ---
    const productsForCostCalc = await prisma.product.findMany({ select: { id: true, costPrice: true } });
    const productCostsMap = new Map(productsForCostCalc.map(p => [p.id, p.costPrice ?? 0]));

    const summary: ComprehensiveReport['summary'] = {
      netSales: activeSaleRecords.reduce((sum, sale) => sum + sale.totalAmount, 0),
      totalDiscounts: activeSaleRecords.reduce((sum, sale) => sum + (sale.totalItemDiscountAmount || 0) + (sale.totalCartDiscountAmount || 0), 0),
      totalTax: activeSaleRecords.reduce((sum, sale) => sum + (sale.taxAmount || 0), 0),
      grossSales: activeSaleRecords.reduce((sum, sale) => sum + (sale.subtotalOriginal || 0), 0),
      costOfGoodsSold: activeSaleRecords.flatMap(s => s.items as unknown as { productId: string; quantity: number }[]).reduce((sum, item) => {
        const cost = productCostsMap.get(item.productId) ?? 0;
        return sum + (cost * item.quantity);
      }, 0),
      totalIncome: financialTransactions.filter(tx => tx.type === 'INCOME').reduce((sum, tx) => sum + tx.amount, 0),
      totalExpense: financialTransactions.filter(tx => tx.type === 'EXPENSE').reduce((sum, tx) => sum + tx.amount, 0),
      totalStockAdjustmentsValue: stockAdjustments.reduce((sum, adj) => {
        if (adj.quantityChanged < 0) {
          const cost = productCostsMap.get(adj.productId) ?? 0;
          return sum + (cost * Math.abs(adj.quantityChanged));
        }
        return sum;
      }, 0),
      totalReturnsValue: 0, // Obsolete, as returns are reflected in active bills
      totalPurchaseValue: purchases.reduce((sum, p) => sum + p.totalAmount, 0),
      totalPaymentsToSuppliers: purchases.flatMap(p => p.payments || []).reduce((sum, payment) => sum + payment.amountPaid, 0),
      netCashFromShifts: cashRegisterShifts.filter(s => s.status === 'CLOSED' && s.closingBalance != null).reduce((sum, s) => sum + (s.closingBalance! - s.openingBalance), 0),
      netProfitLoss: 0, // Calculated last
    };

    // New "Owner's P&L" calculation focusing on cash-like movements and non-cash losses.
    // (Net Sales + Other Income) - (Payments for Stock + Other Expenses + Value of Stock Loss)
    summary.netProfitLoss = (summary.netSales + summary.totalIncome) - (summary.totalPaymentsToSuppliers + summary.totalExpense + summary.totalStockAdjustmentsValue);

    const report: ComprehensiveReport = {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      generatedAt: new Date().toISOString(),
      summary,
      sales: allSales,
      returns: allReturns,
      financialTransactions: financialTransactions as unknown as FinancialTransaction[],
      stockAdjustments,
      purchases: purchases as unknown as PurchaseBill[],
      cashRegisterShifts,
      newOrUpdatedProducts,
      newOrUpdatedParties,
    };

    return { success: true, data: report };

  } catch (error: any) {
    console.error('Error generating comprehensive report:', error);
    return { success: false, error: 'Failed to generate report. ' + error.message };
  }
}


export async function getUsersForReportFilterAction(): Promise<{
  success: boolean;
  data?: { id: string; username: string }[];
  error?: string;
}> {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        username: true,
      },
      orderBy: {
        username: 'asc',
      },
    });
    return { success: true, data: users };
  } catch (error) {
    console.error('Error fetching users for report filter:', error);
    return { success: false, error: 'Failed to load user list.' };
  }
}
