
'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { DateRange } from 'react-day-picker';
import { addDays, format, startOfDay, endOfDay } from 'date-fns';
import { getComprehensiveReportAction, getUsersForReportFilterAction } from '@/app/actions/reportActions';
import type { ComprehensiveReport, User, SaleRecord, PurchaseBill, PurchaseBillStatusEnum } from '@/types';
import { ReportPrintLayout } from '@/components/dashboard/reports/ReportPrintLayout';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, CalendarIcon, UserIcon, BarChart3, Printer, AlertTriangle, Package, ShoppingCart, Users, Briefcase, Archive, Wallet, Tag, CornerDownRight, TrendingUp, TrendingDown, ChevronsRight, FileText, Sigma, FileDiff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Prisma } from '@prisma/client';
import { useSelector } from 'react-redux';
import { selectCurrentUser } from '@/store/slices/authSlice';

export default function ReportsPage() {
  const { toast } = useToast();
  const currentUser = useSelector(selectCurrentUser);
  const [date, setDate] = useState<DateRange | undefined>({ from: startOfDay(addDays(new Date(), -30)), to: endOfDay(new Date()) });
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [reportData, setReportData] = useState<ComprehensiveReport | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  
  const isSuperAdminWithoutCompany = currentUser?.role?.name === 'Admin' && !currentUser?.companyId;

  const salesTransactionGroups = useMemo(() => {
    if (!reportData) return [];
    
    const grouped = new Map<string, { original: SaleRecord; adjusted: SaleRecord | null; returns: SaleRecord[] }>();

    reportData.sales.forEach(sale => {
      if (sale.status === 'COMPLETED_ORIGINAL') {
        grouped.set(sale.billNumber, { original: sale, adjusted: null, returns: [] });
      }
    });

    reportData.sales.forEach(sale => {
      if (sale.status === 'ADJUSTED_ACTIVE' && sale.originalSaleRecordId) {
        const original = reportData.sales.find(s => s.id === sale.originalSaleRecordId);
        if (original && grouped.has(original.billNumber)) {
          const existing = grouped.get(original.billNumber)!;
          if (!existing.adjusted || new Date(sale.date) > new Date(existing.adjusted.date)) {
            existing.adjusted = sale;
          }
        }
      }
    });
    reportData.returns.forEach(ret => {
      const original = reportData.sales.find(s => s.id === ret.originalSaleRecordId);
      if (original && grouped.has(original.billNumber)) {
        grouped.get(original.billNumber)!.returns.push(ret);
      }
    });

    return Array.from(grouped.values()).sort((a,b) => new Date(b.original.date).getTime() - new Date(a.original.date).getTime());
  }, [reportData]);


  useEffect(() => {
    async function fetchUsers() {
      if (!currentUser?.id) return;
      const result = await getUsersForReportFilterAction(currentUser.id);
      if (result.success && result.data) {
        setUsers(result.data);
      } else {
        toast({ title: 'Error', description: result.error || 'Could not load users for filter.', variant: 'destructive' });
      }
    }
    fetchUsers();
  }, [toast, currentUser]);

  const handleGenerateReport = useCallback(async () => {
    if (!date?.from) {
      toast({ title: 'Invalid Date', description: 'Please select a date or date range.', variant: 'destructive' });
      return;
    }
    if (!currentUser?.id) {
       toast({ title: 'Authentication Error', description: 'Cannot generate report, user not found.', variant: 'destructive' });
       return;
    }
    setIsLoading(true);
    setReportData(null);
    
    const fromDate = startOfDay(date.from);
    const toDate = endOfDay(date.to || date.from); // If date.to is not set, use date.from
    
    const result = await getComprehensiveReportAction(fromDate, toDate, currentUser.id, selectedUserId === 'all' ? null : selectedUserId);
    if (result.success && result.data) {
      setReportData(result.data);
      toast({ title: 'Report Generated', description: 'Report successfully created.' });
    } else {
      toast({ title: 'Error Generating Report', description: result.error, variant: 'destructive' });
    }
    setIsLoading(false);
  }, [date, selectedUserId, toast, currentUser]);
  
  const handleSetPreset = (range: { from: Date; to: Date; }) => {
    setDate(range);
    setIsPopoverOpen(false);
  };
  
  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    
    const printWindow = window.open('', '', 'height=800,width=1000');
    if (printWindow) {
      printWindow.document.write('<html><head><title>Print Report</title>');
      printWindow.document.write('<style>body { font-family: sans-serif; margin: 20px; } table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 0.8em; } th, td { border: 1px solid #ddd; padding: 6px; text-align: left; } tr:nth-child(even) {background-color: #f9f9f9;} th { background-color: #f2f2f2; } h1, h2, h3, h4 { color: #333; } .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; } .summary-card { border: 1px solid #ddd; padding: 1rem; border-radius: 0.5rem; } .summary-card h4 { margin-top: 0; } .final-summary { border-top: 2px solid #333; margin-top: 1rem; padding-top: 1rem; } .final-summary .row { display: flex; justify-content: space-between; font-size: 1.1em; } .no-print { display: none; } @page { size: A4; margin: 20mm; } @media print { body { -webkit-print-color-adjust: exact; } .no-print { display: none !important; } } </style>');
      printWindow.document.write('</head><body>');
      printWindow.document.write(content.innerHTML);
      printWindow.document.write('</body></html>');
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
         printWindow.print();
         printWindow.close();
      }, 250);
    }
  };

  const getPurchaseStatusBadgeVariant = (status: PurchaseBillStatusEnum): 'destructive' | 'secondary' | 'default' | 'outline' => {
    if (status === 'COMPLETED') return 'destructive';
    if (status === 'PARTIALLY_PAID') return 'secondary';
    if (status === 'PAID') return 'default';
    return 'outline';
  };

  const getPurchaseStatusDisplayName = (status: PurchaseBillStatusEnum): string => {
      if (status === 'COMPLETED') return 'Awaiting Payment';
      return status.replace(/_/g, ' ');
  };


  return (
    <div className="flex flex-col flex-1 p-4 md:p-6 bg-gradient-to-br from-background to-secondary text-foreground">
      <header className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center space-x-3">
          <Button asChild variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground">
            <Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard</Link>
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center">
            <BarChart3 className="mr-3 h-7 w-7" /> Reports &amp; Analytics
          </h1>
        </div>
      </header>

      <Card className="mb-6 bg-card border-border shadow-lg">
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
          <CardDescription>Select the criteria for your report.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="grid gap-2">
            <Label htmlFor="date">Date range</Label>
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>
                <Button id="date" variant="outline" className={cn("w-[300px] justify-start text-left font-normal bg-input border-border", !date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date?.from ? (
                      date.to && format(startOfDay(date.from), 'yyyy-MM-dd') !== format(startOfDay(date.to), 'yyyy-MM-dd') ? (
                          `${format(date.from, "LLL dd, y")} - ${format(date.to, "LLL dd, y")}`
                      ) : (
                          format(date.from, "LLL dd, y")
                      )
                  ) : (
                      <span>Pick a date or range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 flex" align="start">
                 <div className="p-4 flex flex-col space-y-2 border-r border-border">
                    <h4 className="font-medium text-sm text-center pb-2">Presets</h4>
                    <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => handleSetPreset({ from: new Date(), to: new Date() })}>Today</Button>
                    <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => handleSetPreset({ from: addDays(new Date(), -1), to: addDays(new Date(), -1) })}>Yesterday</Button>
                    <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => handleSetPreset({ from: addDays(new Date(), -7), to: new Date() })}>Last 7 Days</Button>
                    <Button variant="ghost" className="justify-start text-xs h-8" onClick={() => handleSetPreset({ from: addDays(new Date(), -30), to: new Date() })}>Last 30 Days</Button>
                </div>
                <Calendar initialFocus mode="range" defaultMonth={date?.from} selected={date} onSelect={setDate} numberOfMonths={2} />
              </PopoverContent>
            </Popover>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-select">User</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger className="w-[180px] bg-input border-border">
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {users.map(user => (
                  <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleGenerateReport} disabled={isLoading || isSuperAdminWithoutCompany} className="self-end sm:ml-auto bg-primary text-primary-foreground hover:bg-primary/90">
            {isLoading ? 'Generating...' : 'Generate Report'}
          </Button>
          <Button onClick={handlePrint} disabled={!reportData} variant="outline" className="self-end border-accent text-accent hover:bg-accent hover:text-accent-foreground">
            <Printer className="mr-2 h-4 w-4" /> Print / Export PDF
          </Button>
        </CardContent>
      </Card>

       {isSuperAdminWithoutCompany && (
        <Card className="mb-4 border-yellow-500/50 bg-yellow-950/30">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-yellow-400" />
            <div>
              <p className="font-semibold text-yellow-300">Super Admin Notice</p>
              <p className="text-xs text-yellow-400">
                Reports are company-specific. To generate a report, please ensure your Super Admin account is associated with a company in the User Management settings.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
      
      {isLoading && <div className="text-center p-8"><p className="text-muted-foreground">Generating your report, please wait...</p></div>}
      
      {!isLoading && !reportData && !isSuperAdminWithoutCompany && (
          <div className="text-center p-8 border-2 border-dashed border-border rounded-lg bg-card mt-4">
              <BarChart3 className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium text-foreground">No Report Generated</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                  Select your desired filters and click "Generate Report" to see the data.
              </p>
          </div>
      )}

      {reportData && (
        <ScrollArea className="flex-1">
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Profit &amp; Loss Summary</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <Table className="border border-green-800/50">
                      <TableHeader>
                        <TableRow className="bg-green-950/30 border-green-800/50 hover:bg-green-950/40">
                          <TableHead className="text-lg font-semibold text-green-400" colSpan={2}>
                            <TrendingUp className="inline-block mr-2 h-5 w-5"/> Income / Gains
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="border-green-800/50">
                          <TableCell className="text-muted-foreground">Net Sales (from Active Bills)</TableCell>
                          <TableCell className="text-right font-medium text-green-300">Rs. {reportData.summary.netSales.toFixed(2)}</TableCell>
                        </TableRow>
                        <TableRow className="border-green-800/50">
                          <TableCell className="text-muted-foreground">Other Income</TableCell>
                          <TableCell className="text-right font-medium text-green-300">Rs. {reportData.summary.totalIncome.toFixed(2)}</TableCell>
                        </TableRow>
                      </TableBody>
                      <TableFooter className="bg-green-950/30 border-t border-green-800/50">
                        <TableRow>
                          <TableCell className="font-bold text-base text-green-200">Total Income / Gains</TableCell>
                          <TableCell className="text-right font-bold text-base text-green-200">Rs. {(reportData.summary.netSales + reportData.summary.totalIncome).toFixed(2)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                  <div>
                    <Table className="border border-red-800/50">
                      <TableHeader>
                        <TableRow className="bg-red-950/30 border-red-800/50 hover:bg-red-950/40">
                          <TableHead className="text-lg font-semibold text-red-400" colSpan={2}>
                            <TrendingDown className="inline-block mr-2 h-5 w-5"/> Expenses &amp; Outflows
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow className="border-red-800/50">
                          <TableCell className="text-muted-foreground">Payments to Suppliers</TableCell>
                          <TableCell className="text-right font-medium text-red-300">Rs. {reportData.summary.totalPaymentsToSuppliers.toFixed(2)}</TableCell>
                        </TableRow>
                        <TableRow className="border-red-800/50">
                          <TableCell className="text-muted-foreground">Other Expenses</TableCell>
                          <TableCell className="text-right font-medium text-red-300">Rs. {reportData.summary.totalExpense.toFixed(2)}</TableCell>
                        </TableRow>
                        <TableRow className="border-red-800/50">
                          <TableCell className="text-muted-foreground">Stock Loss Value (Non-Cash)</TableCell>
                          <TableCell className="text-right font-medium text-red-300">Rs. {reportData.summary.totalStockAdjustmentsValue.toFixed(2)}</TableCell>
                        </TableRow>
                      </TableBody>
                      <TableFooter className="bg-red-950/30 border-t border-red-800/50">
                        <TableRow>
                          <TableCell className="font-bold text-base text-red-200">Total Expenses &amp; Outflows</TableCell>
                          <TableCell className="text-right font-bold text-base text-red-200">Rs. {(reportData.summary.totalPaymentsToSuppliers + reportData.summary.totalExpense + reportData.summary.totalStockAdjustmentsValue).toFixed(2)}</TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t-2 border-primary/50">
                  <div className="flex justify-between items-center text-xl font-bold">
                    <span className="text-primary flex items-center"><Sigma className="mr-2 h-5 w-5"/> NET PROFIT / LOSS</span>
                    <span className={reportData.summary.netProfitLoss >= 0 ? 'text-green-400' : 'text-red-400'}>
                      Rs. {reportData.summary.netProfitLoss.toFixed(2)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Accordion type="multiple" defaultValue={['sales']} className="w-full space-y-4">
              <AccordionItem value="sales-metrics"><AccordionTrigger><Tag className="mr-2 h-4 w-4"/>Sales &amp; Inventory Metrics</AccordionTrigger><AccordionContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card><CardHeader><CardTitle className="text-base">Sales Analysis</CardTitle></CardHeader><CardContent>
                    <Table>
                      <TableBody>
                        <TableRow><TableCell className="text-muted-foreground">Gross Sales</TableCell><TableCell className="text-right">Rs. {reportData.summary.grossSales.toFixed(2)}</TableCell></TableRow>
                        <TableRow><TableCell className="text-muted-foreground">Discounts Given</TableCell><TableCell className="text-right text-red-400">- Rs. {reportData.summary.totalDiscounts.toFixed(2)}</TableCell></TableRow>
                        <TableRow className="font-semibold border-t-2 border-border"><TableCell>Net Sales</TableCell><TableCell className="text-right">Rs. {reportData.summary.netSales.toFixed(2)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </CardContent></Card>
                  <Card><CardHeader><CardTitle className="text-base">Inventory Cost Analysis</CardTitle></CardHeader><CardContent>
                     <Table>
                      <TableBody>
                         <TableRow><TableCell className="text-muted-foreground">Cost of Goods Sold (COGS)</TableCell><TableCell className="text-right">Rs. {reportData.summary.costOfGoodsSold.toFixed(2)}</TableCell></TableRow>
                         <TableRow><TableCell className="text-muted-foreground">Stock Loss Value</TableCell><TableCell className="text-right">Rs. {reportData.summary.totalStockAdjustmentsValue.toFixed(2)}</TableCell></TableRow>
                      </TableBody>
                    </Table>
                  </CardContent></Card>
                </div>
              </AccordionContent></AccordionItem>

               <AccordionItem value="sales"><AccordionTrigger><FileText className="mr-2 h-4 w-4"/>Sales &amp; Returns Transactions</AccordionTrigger><AccordionContent>
                <Card><CardHeader><CardTitle>Sales Transactions ({salesTransactionGroups.length} original bills)</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {salesTransactionGroups.length > 0 ? salesTransactionGroups.map(group => {
                    const activeBill = group.adjusted || group.original;
                    const originalIsSuperseded = !!group.adjusted;
                    const totalDiscount = (activeBill.totalItemDiscountAmount || 0) + (activeBill.totalCartDiscountAmount || 0);
                    const totalItems = (activeBill.items as any[])?.reduce((sum, item) => sum + item.quantity, 0);
                    
                    return (
                        <div key={group.original.id} className="border border-border/50 rounded-lg shadow-sm overflow-hidden p-3 space-y-2 bg-card">
                            <h4 className="font-semibold text-sm text-foreground flex justify-between items-center">
                                <span>Transaction Group: {group.original.billNumber}</span>
                                <span className="text-xs text-muted-foreground ml-2 flex items-center"><UserIcon className="h-3 w-3 mr-1.5"/>{group.original.createdBy?.username || 'N/A'}</span>
                            </h4>
                            <Table>
                                <TableBody>
                                    <TableRow className={cn("hover:bg-green-950/80 border-b border-green-800/50", originalIsSuperseded ? "bg-green-950/30" : "bg-green-950/70")}>
                                        <TableCell>{new Date(activeBill.date).toLocaleString()}</TableCell>
                                        <TableCell>{activeBill.billNumber}</TableCell>
                                        <TableCell>{activeBill.customer?.name || 'N/A'}</TableCell>
                                        <TableCell>
                                            <Badge variant="default" className="bg-green-600">Active Bill</Badge>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                <span>{totalItems} units in {(activeBill.items as any[])?.length || 0} items</span>
                                                {totalDiscount > 0 && 
                                                    <span className="ml-2 pl-2 border-l border-border/50">
                                                        Discount: Rs. {totalDiscount.toFixed(2)}
                                                    </span>
                                                }
                                                <span className="ml-2 pl-2 border-l border-border/50">
                                                    Paid by: {activeBill.paymentMethod}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-green-300">Rs. {activeBill.totalAmount.toFixed(2)}</TableCell>
                                    </TableRow>

                                    {originalIsSuperseded && (
                                        <TableRow className="bg-muted/30 hover:bg-muted/40 opacity-70 border-b border-border/50">
                                            <TableCell>{new Date(group.original.date).toLocaleString()}</TableCell>
                                            <TableCell>{group.original.billNumber}</TableCell>
                                            <TableCell>{group.original.customer?.name || 'N/A'}</TableCell>
                                            <TableCell><Badge variant="secondary">Original (Superseded)</Badge><span className="ml-2 text-xs text-muted-foreground">{(group.original.items as any[])?.length || 0} items</span></TableCell>
                                            <TableCell className="text-right line-through text-muted-foreground">Rs. {group.original.totalAmount.toFixed(2)}</TableCell>
                                        </TableRow>
                                    )}
                                    
                                    {group.returns.map(ret => {
                                        const totalQtyReturned = (ret.items as any[]).reduce((sum, item) => sum + item.quantity, 0);
                                        return (
                                        <TableRow key={ret.id} className="hover:bg-red-950/30 opacity-80 border-b-0">
                                            <TableCell className="pl-6 text-muted-foreground">{new Date(ret.date).toLocaleString()}</TableCell>
                                            <TableCell className="text-muted-foreground"><CornerDownRight className="inline-block h-4 w-4 mr-2 text-red-500" />{ret.billNumber}</TableCell>
                                            <TableCell></TableCell>
                                            <TableCell>
                                                <Badge variant="destructive" className="bg-red-700">Return</Badge>
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    {totalQtyReturned} units returned
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right text-red-400">- Rs. {ret.totalAmount.toFixed(2)}</TableCell>
                                        </TableRow>
                                    )})}
                                </TableBody>
                            </Table>
                        </div>
                    );
                  }) : (
                    <p className="text-center text-muted-foreground">No sales in this period.</p>
                  )}
                  <Table>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={4} className="text-right font-bold">Net Sales from Active Bills:</TableCell>
                        <TableCell className="text-right font-bold">Rs. {reportData.summary.netSales.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </CardContent></Card>
              </AccordionContent></AccordionItem>
              
              <AccordionItem value="purchases"><AccordionTrigger><ShoppingCart className="mr-2 h-4 w-4"/>Purchases</AccordionTrigger><AccordionContent>
                <Card><CardHeader><CardTitle>Purchase Bills ({reportData.purchases.length})</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Supplier Bill No</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>{reportData.purchases.length > 0 ? reportData.purchases.map(p => (<TableRow key={p.id}><TableCell>{new Date(p.purchaseDate).toLocaleDateString()}</TableCell><TableCell>{p.createdBy?.username || 'N/A'}</TableCell><TableCell>{p.supplierBillNumber}</TableCell><TableCell>{p.supplier?.name}</TableCell><TableCell className="text-right">Rs. {p.totalAmount.toFixed(2)}</TableCell>
                    <TableCell><Badge variant={getPurchaseStatusBadgeVariant(p.paymentStatus)}>{getPurchaseStatusDisplayName(p.paymentStatus)}</Badge></TableCell>
                    </TableRow>))
                    : <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No purchases recorded.</TableCell></TableRow>}</TableBody>
                    <TableFooter><TableRow><TableCell colSpan={5} className="text-right font-bold">Total Purchases:</TableCell><TableCell className="text-right font-bold">Rs. {reportData.summary.totalPurchaseValue.toFixed(2)}</TableCell><TableCell></TableCell></TableRow></TableFooter>
                    </Table>
                </CardContent></Card>
              </AccordionContent></AccordionItem>

              <AccordionItem value="financials"><AccordionTrigger><Briefcase className="mr-2 h-4 w-4"/>Income &amp; Expenses</AccordionTrigger><AccordionContent>
                <Card><CardHeader><CardTitle>Financial Transactions ({reportData.financialTransactions.length})</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Type</TableHead><TableHead>Category</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                    <TableBody>{reportData.financialTransactions.length > 0 ? reportData.financialTransactions.map(tx => (<TableRow key={tx.id}><TableCell>{new Date(tx.date).toLocaleDateString()}</TableCell><TableCell>{tx.user?.username || 'N/A'}</TableCell><TableCell><Badge variant={tx.type === 'INCOME' ? 'default' : 'destructive'} className={tx.type === 'INCOME' ? 'bg-green-500/80' : 'bg-red-500/80'}>{tx.type}</Badge></TableCell><TableCell>{tx.category}</TableCell><TableCell>{tx.description}</TableCell><TableCell className={`text-right font-medium ${tx.type === 'INCOME' ? 'text-green-400' : 'text-red-400'}`}>Rs. {tx.amount.toFixed(2)}</TableCell></TableRow>))
                    : <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No financial transactions.</TableCell></TableRow>}</TableBody>
                     <TableFooter><TableRow><TableCell colSpan={4} className="text-right font-bold">Total Other Income/Expense:</TableCell><TableCell className="text-right font-bold text-green-400">+Rs. {reportData.summary.totalIncome.toFixed(2)}</TableCell><TableCell className="text-right font-bold text-red-400">-Rs. {reportData.summary.totalExpense.toFixed(2)}</TableCell></TableRow></TableFooter>
                    </Table>
                </CardContent></Card>
              </AccordionContent></AccordionItem>

              <AccordionItem value="stock"><AccordionTrigger><Archive className="mr-2 h-4 w-4"/>Stock Adjustments</AccordionTrigger><AccordionContent>
                 <Card><CardHeader><CardTitle>Stock Adjustments ({reportData.stockAdjustments.length})</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>User</TableHead><TableHead>Product</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Qty Changed</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader>
                    <TableBody>{reportData.stockAdjustments.length > 0 ? reportData.stockAdjustments.map(adj => (<TableRow key={adj.id}><TableCell>{new Date(adj.adjustedAt).toLocaleString()}</TableCell><TableCell>{adj.user?.username || 'N/A'}</TableCell><TableCell>{adj.product.name}</TableCell><TableCell>{adj.reason}</TableCell><TableCell className={`text-right font-medium ${adj.quantityChanged > 0 ? 'text-green-400' : 'text-red-400'}`}>{adj.quantityChanged}</TableCell><TableCell>{adj.notes}</TableCell></TableRow>))
                    : <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No stock adjustments.</TableCell></TableRow>}</TableBody>
                    <TableFooter><TableRow><TableCell colSpan={5} className="text-right font-bold">Total Stock Loss Value:</TableCell><TableCell className="text-right font-bold text-red-400">Rs. {reportData.summary.totalStockAdjustmentsValue.toFixed(2)}</TableCell></TableRow></TableFooter>
                    </Table>
                </CardContent></Card>
              </AccordionContent></AccordionItem>
              
              <AccordionItem value="cash"><AccordionTrigger><Wallet className="mr-2 h-4 w-4"/>Cash Register</AccordionTrigger><AccordionContent>
                 <Card><CardHeader><CardTitle>Cash Register Shifts ({reportData.cashRegisterShifts.length})</CardTitle></CardHeader><CardContent>
                   <Table><TableHeader><TableRow><TableHead>User</TableHead><TableHead>Started</TableHead><TableHead>Closed</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Closing</TableHead><TableHead className="text-right">Net</TableHead></TableRow></TableHeader>
                     <TableBody>{reportData.cashRegisterShifts.length > 0 ? reportData.cashRegisterShifts.map(s => { const net = s.closingBalance ? s.closingBalance - s.openingBalance : null; return (<TableRow key={s.id}><TableCell>{s.user?.username}</TableCell><TableCell>{new Date(s.startedAt).toLocaleString()}</TableCell><TableCell>{s.closedAt ? new Date(s.closedAt).toLocaleString() : "OPEN"}</TableCell><TableCell className="text-right">Rs. {s.openingBalance.toFixed(2)}</TableCell><TableCell className="text-right">{s.closingBalance ? `Rs. ${s.closingBalance.toFixed(2)}` : 'N/A'}</TableCell><TableCell className={`text-right font-medium ${net === null ? '' : (net >= 0 ? 'text-green-400' : 'text-red-400')}`}>{net !== null ? `Rs. ${net.toFixed(2)}` : 'N/A'}</TableCell></TableRow>);})
                    : <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No cash shifts in this period.</TableCell></TableRow>}</TableBody>
                    <TableFooter><TableRow><TableCell colSpan={5} className="text-right font-bold">Net Cash Change from Shifts:</TableCell><TableCell className="text-right font-bold">Rs. {reportData.summary.netCashFromShifts.toFixed(2)}</TableCell></TableRow></TableFooter>
                    </Table>
                 </CardContent></Card>
              </AccordionContent></AccordionItem>

              <AccordionItem value="updates"><AccordionTrigger><FileDiff className="mr-2 h-4 w-4"/>Product &amp; Contact Updates</AccordionTrigger><AccordionContent>
                <Card><CardHeader><CardTitle>Products Created/Updated ({reportData.newOrUpdatedProducts.length})</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Updated At</TableHead></TableRow></TableHeader>
                    <TableBody>{reportData.newOrUpdatedProducts.length > 0 ? reportData.newOrUpdatedProducts.map(p => (<TableRow key={`prod-${p.id}`}><TableCell>{p.name}</TableCell><TableCell>{p.category}</TableCell><TableCell>{new Date(p.updatedAt!).toLocaleString()}</TableCell></TableRow>))
                    : <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No products updated in this period.</TableCell></TableRow>}</TableBody></Table>
                </CardContent></Card>
                <Card className="mt-4"><CardHeader><CardTitle>Contacts Created/Updated ({reportData.newOrUpdatedParties.length})</CardTitle></CardHeader><CardContent>
                  <Table><TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Updated At</TableHead></TableRow></TableHeader>
                    <TableBody>{reportData.newOrUpdatedParties.length > 0 ? reportData.newOrUpdatedParties.map(p => (<TableRow key={`party-${p.id}`}><TableCell>{p.name}</TableCell><TableCell>{p.type}</TableCell><TableCell>{new Date(p.updatedAt!).toLocaleString()}</TableCell></TableRow>))
                    : <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No contacts updated in this period.</TableCell></TableRow>}</TableBody></Table>
                </CardContent></Card>
              </AccordionContent></AccordionItem>

            </Accordion>
          </div>
        </ScrollArea>
      )}
       <div style={{ display: 'none' }}><div ref={printRef}>{reportData && <ReportPrintLayout data={reportData} />}</div></div>
    </div>
  );
}
