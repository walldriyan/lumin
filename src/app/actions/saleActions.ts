
'use server';

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { SaleRecordSchema, CreditPaymentStatusEnumSchema, UndoReturnItemInputSchema, UnitDefinitionSchema, ReturnedItemDetailSchema, AppliedRuleInfoSchema } from '@/lib/zodSchemas';
import type { SaleRecord as SaleRecordType, SaleRecordItem as SaleRecordItemType, UnitDefinition, PaymentInstallment, CreditPaymentStatus, AppliedRuleInfo, ReturnedItemDetail as ReturnedItemDetailType, SaleRecordInput, DiscountSet, SpecificDiscountRuleConfig as TypesSpecificDiscountRuleConfig, Product as ProductType, ReturnedItemDetailInput, SaleItem, SaleStatus, PaymentMethod } from '@/types';
import { z } from 'zod';
import { calculateDiscountsForItems } from '@/lib/discountUtils';

function mapPrismaSaleToRecordType(record: any, _hasReturnsFlag?: boolean): SaleRecordType | null {
  try {
    const itemsFromDb = (record.items !== Prisma.JsonNull && Array.isArray(record.items)) ? record.items : [];
    const returnedItemsLogFromDb = (record.returnedItemsLog !== Prisma.JsonNull && Array.isArray(record.returnedItemsLog)) ? record.returnedItemsLog : [];
    const paymentInstallmentsFromDb = Array.isArray(record.paymentInstallments) ? record.paymentInstallments : [];

    const parsedUnitsOnError: UnitDefinition = { baseUnit: "unknown_error_unit", derivedUnits: [] };

    let parsedAppliedDiscountSummary: AppliedRuleInfo[] = [];
    if (record.appliedDiscountSummary === Prisma.JsonNull) {
        parsedAppliedDiscountSummary = [];
    } else if (record.appliedDiscountSummary && typeof record.appliedDiscountSummary === 'object' && !Array.isArray(record.appliedDiscountSummary) && Object.keys(record.appliedDiscountSummary).length === 0) {
        parsedAppliedDiscountSummary = [];
    } else if (record.appliedDiscountSummary && Array.isArray(record.appliedDiscountSummary)) {
      try {
        parsedAppliedDiscountSummary = z.array(AppliedRuleInfoSchema).parse(record.appliedDiscountSummary);
      } catch (e: any) {
        console.warn(`Failed to parse AppliedRuleInfo array for bill ${record.billNumber}: ${JSON.stringify(record.appliedDiscountSummary)}. Errors: ${e.message}. Defaulting to empty array.`);
        parsedAppliedDiscountSummary = [];
      }
    } else if (record.appliedDiscountSummary) { 
      console.warn(`Malformed appliedDiscountSummary data for bill ${record.billNumber} (expected array, empty object, or null): ${JSON.stringify(record.appliedDiscountSummary)}. Defaulting to empty array.`);
      parsedAppliedDiscountSummary = [];
    }


    const recordTypeValidated = ['SALE', 'RETURN_TRANSACTION'].includes(record.recordType) ? record.recordType as SaleRecordType['recordType'] : 'SALE';
    if (!['SALE', 'RETURN_TRANSACTION'].includes(record.recordType)) {
        console.warn(`Invalid recordType: ${record.recordType} for bill ${record.billNumber}. Defaulting to SALE.`);
    }

    const statusValidated = ['COMPLETED_ORIGINAL', 'ADJUSTED_ACTIVE', 'RETURN_TRANSACTION_COMPLETED'].includes(record.status) ? record.status as SaleStatus : 'COMPLETED_ORIGINAL';
    if(!['COMPLETED_ORIGINAL', 'ADJUSTED_ACTIVE', 'RETURN_TRANSACTION_COMPLETED'].includes(record.status)){
        console.warn(`Invalid status: ${record.status} for bill ${record.billNumber}. Defaulting to COMPLETED_ORIGINAL.`);
    }

    const paymentMethodValidated = ['cash', 'credit', 'REFUND'].includes(record.paymentMethod) ? record.paymentMethod as PaymentMethod : 'cash';
    if(!['cash', 'credit', 'REFUND'].includes(record.paymentMethod)){
        console.warn(`Invalid paymentMethod: ${record.paymentMethod} for bill ${record.billNumber}. Defaulting to cash.`);
    }

    return {
      id: record.id || `error-missing-id-${Date.now()}`,
      createdByUserId: record.createdByUserId,
      createdBy: record.createdBy,
      recordType: recordTypeValidated,
      billNumber: record.billNumber || `ERR_BN_${Date.now()}`,
      date: record.date ? new Date(record.date).toISOString() : new Date().toISOString(),
      customerName: record.customer?.name ?? null,
      customerId: record.customerId || null,
      items: itemsFromDb.map((item: any) => {
        let unitsForLog: UnitDefinition;
        if (item.units && typeof item.units === 'object' && !Array.isArray(item.units)) {
            const parsedUnitsResult = UnitDefinitionSchema.safeParse(item.units);
            unitsForLog = parsedUnitsResult.success ? parsedUnitsResult.data : parsedUnitsOnError;
            if (!parsedUnitsResult.success) {
              console.warn(`SaleRecordItem (ID: ${item.id}, Product ID: ${item.productId}, Bill: ${record.billNumber}) has invalid units data. Defaulting. Error: ${JSON.stringify(parsedUnitsResult.error.flatten().fieldErrors)} Data: ${JSON.stringify(item.units)}`);
            }
        } else {
              console.warn(`SaleRecordItem (ID: ${item.id}, Product ID: ${item.productId}, Bill: ${record.billNumber}) has missing or malformed units data. Defaulting. Original Data: ${JSON.stringify(item.units)}`);
              unitsForLog = parsedUnitsOnError;
        }
        return {
          productId: item.productId || 'unknown_product_id',
          name: item.name || 'Unknown Item',
          price: typeof item.price === 'number' ? item.price : 0,
          category: item.category || null,
          imageUrl: item.imageUrl || null,
          units: unitsForLog,
          quantity: typeof item.quantity === 'number' ? item.quantity : 0,
          priceAtSale: typeof item.priceAtSale === 'number' ? item.priceAtSale : 0,
          effectivePricePaidPerUnit: typeof item.effectivePricePaidPerUnit === 'number' ? item.effectivePricePaidPerUnit : 0,
          totalDiscountOnLine: typeof item.totalDiscountOnLine === 'number' ? item.totalDiscountOnLine : 0,
        };
      }),
      subtotalOriginal: typeof record.subtotalOriginal === 'number' ? record.subtotalOriginal : 0,
      totalItemDiscountAmount: typeof record.totalItemDiscountAmount === 'number' ? record.totalItemDiscountAmount : 0,
      totalCartDiscountAmount: typeof record.totalCartDiscountAmount === 'number' ? record.totalCartDiscountAmount : 0,
      netSubtotal: typeof record.netSubtotal === 'number' ? record.netSubtotal : 0,
      appliedDiscountSummary: parsedAppliedDiscountSummary,
      activeDiscountSetId: record.activeDiscountSetId || null,
      taxRate: typeof record.taxRate === 'number' ? record.taxRate : 0,
      taxAmount: typeof record.taxAmount === 'number' ? record.taxAmount : 0,
      totalAmount: typeof record.totalAmount === 'number' ? record.totalAmount : 0,
      paymentMethod: paymentMethodValidated,
      amountPaidByCustomer: typeof record.amountPaidByCustomer === 'number' ? record.amountPaidByCustomer : null,
      changeDueToCustomer: typeof record.changeDueToCustomer === 'number' ? record.changeDueToCustomer : null,
      status: statusValidated,
      returnedItemsLog: returnedItemsLogFromDb.map((log: any) => {
        let unitsForLog: UnitDefinition;
        if (log.units && typeof log.units === 'object' && !Array.isArray(log.units)) {
            const parsedUnitsResult = UnitDefinitionSchema.safeParse(log.units);
            unitsForLog = parsedUnitsResult.success ? parsedUnitsResult.data : parsedUnitsOnError;
            if (!parsedUnitsResult.success) {
              console.warn(`ReturnedItemDetail (ID: ${log.id}, Item ID: ${log.itemId}, Bill: ${record.billNumber}) has invalid units data. Defaulting. Error: ${JSON.stringify(item.units)}`);
            }
        } else {
              console.warn(`ReturnedItemDetail (ID: ${log.id}, Item ID: ${log.itemId}, Bill: ${record.billNumber}) has missing or malformed units data. Defaulting. Original Data: ${JSON.stringify(item.units)}`);
              unitsForLog = parsedUnitsOnError;
        }
        const parsedLog = ReturnedItemDetailSchema.safeParse({ ...log, units: unitsForLog, returnDate: new Date(log.returnDate).toISOString() });
        if (!parsedLog.success) {
            console.warn(`Failed to parse ReturnedItemDetail from DB (ID: ${log.id}, Bill: ${record.billNumber}). Errors: ${JSON.stringify(parsedLog.error.flatten().fieldErrors)} Data: ${JSON.stringify(log)}`);
            return {
              id: log.id || `error-parsing-log-${Date.now()}`, 
              itemId: log.itemId || 'unknown_item',
              name: log.name || 'Unknown Item',
              returnedQuantity: typeof log.returnedQuantity === 'number' ? log.returnedQuantity : 0,
              units: unitsForLog,
              refundAmountPerUnit: typeof log.refundAmountPerUnit === 'number' ? log.refundAmountPerUnit : 0,
              totalRefundForThisReturnEntry: typeof log.totalRefundForThisReturnEntry === 'number' ? log.totalRefundForThisReturnEntry : 0,
              returnDate: log.returnDate ? new Date(log.returnDate).toISOString() : new Date().toISOString(),
              returnTransactionId: log.returnTransactionId || 'unknown_txn',
              isUndone: typeof log.isUndone === 'boolean' ? log.isUndone : false,
              processedByUserId: log.processedByUserId || 'unknown_user',
            };
        }
        return {
          ...parsedLog.data,
          id: parsedLog.data.id!, 
          returnDate: new Date(parsedLog.data.returnDate).toISOString(),
        };
      }),
      originalSaleRecordId: record.originalSaleRecordId || null,
      isCreditSale: typeof record.isCreditSale === 'boolean' ? record.isCreditSale : false,
      creditOutstandingAmount: typeof record.creditOutstandingAmount === 'number' ? record.creditOutstandingAmount : null,
      creditLastPaymentDate: record.creditLastPaymentDate ? new Date(record.creditLastPaymentDate).toISOString() : null,
      creditPaymentStatus: record.creditPaymentStatus ? (CreditPaymentStatusEnumSchema.safeParse(record.creditPaymentStatus).success ? record.creditPaymentStatus as CreditPaymentStatus : null) : null,
      paymentInstallments: paymentInstallmentsFromDb.map((inst: any) => ({
          ...inst,
          id: inst.id || `error-inst-id-${Date.now()}`,
          paymentDate: inst.paymentDate ? new Date(inst.paymentDate).toISOString() : new Date().toISOString(),
          amountPaid: typeof inst.amountPaid === 'number' ? inst.amountPaid : 0,
          method: inst.method || 'UNKNOWN',
          createdAt: inst.createdAt ? new Date(inst.createdAt).toISOString() : undefined,
          updatedAt: inst.updatedAt ? new Date(inst.updatedAt).toISOString() : undefined,
      })),
      _hasReturns: _hasReturnsFlag,
    };
  } catch (mapError: any) {
    console.error(`Error mapping Prisma record ${record?.id} (Bill: ${record?.billNumber}) to SaleRecordType:`, mapError.message, mapError.stack);
    return null;
  }
}


export async function saveSaleRecordAction(
  saleData: SaleRecordInput,
  userId: string
): Promise<{ success: boolean; error?: string; data?: SaleRecordType }> {

  const validationResult = SaleRecordSchema.safeParse(saleData);
  if (!validationResult.success) {
    const flatErrors = validationResult.error.flatten();
    const errorMessages = Object.entries(flatErrors.fieldErrors)
      .map(([field, messages]) => `${field}: ${(messages as string[])?.join(', ')}`)
      .join('; ');
    console.error("SaleRecord Zod validation failed on server:", flatErrors);
    return { success: false, error: `Sale data validation failed: ${errorMessages || flatErrors.formErrors.join(', ')}` };
  }
  const validatedSaleData = validationResult.data;
  
  if (!userId) {
     return { success: false, error: 'User is not authenticated. Cannot save sale.' };
  }

  try {
    const {
        id: recordIdFromInput,
        items: saleItemsInput,
        returnedItemsLog: returnedItemsLogFromInput,
        paymentInstallments: paymentInstallmentsFromInput,
        ...saleRecordFields
    } = validatedSaleData;

    const result = await prisma.$transaction(async (tx) => {
      let savedSaleRecord;

      const commonDataPayload = {
        ...saleRecordFields,
        createdByUserId: userId,
        billNumber: saleRecordFields.billNumber, 
        date: new Date(saleRecordFields.date),
        activeDiscountSetId: saleRecordFields.activeDiscountSetId, 
        appliedDiscountSummary: (saleRecordFields.appliedDiscountSummary && Array.isArray(saleRecordFields.appliedDiscountSummary) ? saleRecordFields.appliedDiscountSummary : Prisma.JsonNull) as Prisma.JsonValue,
        isCreditSale: saleRecordFields.paymentMethod === 'credit' && saleRecordFields.recordType === 'SALE',
        creditOutstandingAmount: (saleRecordFields.paymentMethod === 'credit' && saleRecordFields.recordType === 'SALE') ? saleRecordFields.totalAmount - (saleRecordFields.amountPaidByCustomer || 0) : null,
        creditPaymentStatus: (saleRecordFields.paymentMethod === 'credit' && saleRecordFields.recordType === 'SALE')
          ? ( (Math.max(0, saleRecordFields.totalAmount - (saleRecordFields.amountPaidByCustomer || 0))) <= 0.009 ? CreditPaymentStatusEnumSchema.Enum.FULLY_PAID
              : (saleRecordFields.amountPaidByCustomer || 0) > 0 ? CreditPaymentStatusEnumSchema.Enum.PARTIALLY_PAID
              : CreditPaymentStatusEnumSchema.Enum.PENDING )
          : null,
        creditLastPaymentDate: (saleRecordFields.paymentMethod === 'credit' && saleRecordFields.recordType === 'SALE' && (saleRecordFields.amountPaidByCustomer || 0) > 0) ? new Date(saleRecordFields.date) : null,
        originalSaleRecordId: validatedSaleData.originalSaleRecordId, 
      };
      
      const itemsToStoreInJson = (saleItemsInput || []).map(item => ({
        productId: item.productId,
        name: item.name,
        category: item.category,
        imageUrl: item.imageUrl,
        units: (item.units || { baseUnit: "pcs", derivedUnits: [] }) as Prisma.InputJsonValue,
        quantity: item.quantity,
        priceAtSale: item.priceAtSale,
        effectivePricePaidPerUnit: item.effectivePricePaidPerUnit,
        totalDiscountOnLine: item.totalDiscountOnLine,
      }));
      
      const returnedLogsToStoreAsJson = (returnedItemsLogFromInput || []).map((log, index) => {
        const { id, units, returnDate, ...restOfLog } = log; 
        return {
          ...restOfLog,
          id: id || `log_${Date.now()}_${index}`,
          units: (units || { baseUnit: "pcs", derivedUnits: [] }) as Prisma.InputJsonValue,
          returnDate: new Date(returnDate).toISOString(),
          isUndone: log.isUndone === undefined ? false : log.isUndone,
          processedByUserId: userId, 
        };
      });

      const paymentInstallmentsToCreateForPrisma = (paymentInstallmentsFromInput || []).map(inst => {
        const {id, saleRecordId, createdAt, updatedAt, paymentDate, ...rest } = inst;
        return { ...rest, paymentDate: new Date(paymentDate), recordedByUserId: userId };
      });
      
       if (recordIdFromInput) {
         savedSaleRecord = await tx.saleRecord.update({
            where: { id: recordIdFromInput },
            data: {
              ...commonDataPayload,
              items: itemsToStoreInJson as Prisma.JsonValue,
              returnedItemsLog: (returnedLogsToStoreAsJson.length === 0) ? Prisma.JsonNull : returnedLogsToStoreAsJson as Prisma.JsonValue,
            },
            include: { paymentInstallments: true, customer: true },
         });
       } else {
        const isReturnTransaction = commonDataPayload.recordType === 'RETURN_TRANSACTION';
        if (!isReturnTransaction && commonDataPayload.status !== 'ADJUSTED_ACTIVE') {
            const existingBill = await tx.saleRecord.findFirst({
                where: { billNumber: commonDataPayload.billNumber }
            });
            if (existingBill) {
                throw new Error(`A sale record with bill number '${commonDataPayload.billNumber}' already exists. BillNumber must be unique for original sales.`);
            }
        }
        
        const createDataPayload: Prisma.SaleRecordCreateInput = {
          ...commonDataPayload,
          items: itemsToStoreInJson as Prisma.JsonValue,
          returnedItemsLog: (returnedLogsToStoreAsJson.length === 0) ? Prisma.JsonNull : returnedLogsToStoreAsJson as Prisma.JsonValue,
          paymentInstallments: paymentInstallmentsToCreateForPrisma.length > 0 ? { create: paymentInstallmentsToCreateForPrisma } : undefined,
        };

        savedSaleRecord = await tx.saleRecord.create({
          data: createDataPayload,
          include: { paymentInstallments: true, customer: true },
        });
      }

      if (savedSaleRecord.recordType === 'SALE' && validatedSaleData.status === 'COMPLETED_ORIGINAL' && !validatedSaleData.originalSaleRecordId) {
          for (const item of saleItemsInput) {
              const productToUpdate = await tx.product.findUnique({
                  where: { id: item.productId },
                  select: { isService: true, stock: true },
              });

              if (productToUpdate && !productToUpdate.isService) {
                  const newStock = productToUpdate.stock - item.quantity;
                  if (newStock < 0) {
                      throw new Error(`Insufficient stock for ${item.name}. Required: ${item.quantity}, Available: ${productToUpdate.stock}. Transaction rolled back.`);
                  }
                  await tx.product.update({
                      where: { id: item.productId },
                      data: {
                          stock: newStock,
                          updatedByUserId: userId,
                      },
                  });
              }
          }
      }
      
      if (savedSaleRecord.recordType === 'SALE' &&
          savedSaleRecord.isCreditSale &&
          savedSaleRecord.amountPaidByCustomer &&
          savedSaleRecord.amountPaidByCustomer > 0 &&
          validatedSaleData.status === 'COMPLETED_ORIGINAL' 
        ) {
            await tx.paymentInstallment.create({
              data: {
                saleRecordId: savedSaleRecord.id,
                amountPaid: savedSaleRecord.amountPaidByCustomer,
                method: (commonDataPayload.paymentMethod && commonDataPayload.paymentMethod !== 'REFUND' && commonDataPayload.paymentMethod !== 'credit')
                        ? commonDataPayload.paymentMethod.toUpperCase()
                        : 'CREDIT_INITIAL',
                paymentDate: new Date(savedSaleRecord.date),
                notes: 'Initial payment made at point of sale.',
                recordedByUserId: userId,
              },
            });
      }

      const finalFetchedSaleRecord = await tx.saleRecord.findUniqueOrThrow({
          where: { id: savedSaleRecord.id },
          include: { paymentInstallments: true, customer: true, createdBy: { select: { username: true } } }
      });
      return finalFetchedSaleRecord;
    }, {
      timeout: 10000, 
    });

    const resultData = mapPrismaSaleToRecordType(result);
    if (!resultData) {
      throw new Error("Failed to map saved sale record to type.");
    }
    return { success: true, data: resultData };

  } catch (error) {
    console.error('Error saving sale record to DB:', error);
    let detailedError = 'Failed to save sale record.';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
       detailedError = `Database error (Code: ${error.code}): ${error.message}`;
       if (error.code === 'P2002' && error.meta?.target) {
         const targetFields = error.meta.target as string[];
         if (targetFields.includes('billNumber')) {
           detailedError = `A sale record with bill number '${validatedSaleData.billNumber}' already exists. BillNumber must be unique for original sales.`;
         } else {
           detailedError = `A unique constraint violation occurred on: ${targetFields.join(', ')}.`;
         }
      }
       if (error.code === 'P2025') {
         detailedError = "Record to update or delete not found.";
       }
       if (error.code === 'P2028') {
         detailedError = `Transaction timed out. The operation took too long. Please try again. Details: ${error.message}`;
       }
    } else if (error instanceof Error) {
      detailedError = error.message;
    }
    return { success: false, error: detailedError };
  }
}


export type SaleContext = {
  pristineOriginalSale: SaleRecordType | null;
  latestAdjustedOrOriginal: SaleRecordType | null;
};

export async function getSaleContextByBillNumberAction(
  billNumberToSearch: string,
  userId: string,
  clickedAdjustedSaleId?: string | null
): Promise<{ success: boolean; data?: SaleContext; error?: string }> {
  try {
    const pristineOriginalDbRecord = await prisma.saleRecord.findFirst({
      where: {
        billNumber: billNumberToSearch,
        status: 'COMPLETED_ORIGINAL',
        createdByUserId: userId,
      },
      include: { 
        paymentInstallments: true, 
        customer: true, 
        createdBy: { select: { username: true } }
      },
    });

    if (!pristineOriginalDbRecord) {
      return { success: false, error: `No original sale record found for bill number: ${billNumberToSearch} for this user.` };
    }
    
    // Find the LATEST adjusted sale record related to this original bill.
    const latestAdjustedSale = await prisma.saleRecord.findFirst({
        where: {
            originalSaleRecordId: pristineOriginalDbRecord.id,
            status: 'ADJUSTED_ACTIVE'
        },
        orderBy: { date: 'desc' }, 
        include: { 
          paymentInstallments: true, 
          customer: true, 
          createdBy: { select: { username: true } }
        },
    });

    const hasReturns = (latestAdjustedSale?.returnedItemsLog || pristineOriginalDbRecord?.returnedItemsLog) ? 
        ((latestAdjustedSale?.returnedItemsLog || pristineOriginalDbRecord.returnedItemsLog) as any[]).filter(log => !log.isUndone).length > 0
        : false;

    const mappedPristineOriginal = mapPrismaSaleToRecordType(pristineOriginalDbRecord, hasReturns);
    const mappedLatestAdjusted = latestAdjustedSale ? mapPrismaSaleToRecordType(latestAdjustedSale, hasReturns) : null;
      
    return {
      success: true,
      data: {
        pristineOriginalSale: mappedPristineOriginal,
        latestAdjustedOrOriginal: mappedLatestAdjusted || mappedPristineOriginal,
      },
    };

  } catch (error: any) {
    console.error(`Error fetching sale context for bill ${billNumberToSearch}:`, error);
    return { success: false, error: error.message || "Failed to fetch sale context." };
  }
}


export async function getAllSaleRecordsAction(
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ success: boolean; data?: { sales: SaleRecordType[]; totalCount: number }; error?: string }> {
  if (!userId) {
    return { success: false, error: 'User ID is required.' };
  }
  try {
    const whereClause: Prisma.SaleRecordWhereInput = {
      createdByUserId: userId,
      status: 'COMPLETED_ORIGINAL',
    };

    const [originalSalesFromDb, totalCount] = await prisma.$transaction([
      prisma.saleRecord.findMany({
        where: whereClause,
        include: {
          paymentInstallments: true,
          customer: true,
          createdBy: { select: { username: true } },
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.saleRecord.count({ where: whereClause }),
    ]);

    const originalSaleIds = originalSalesFromDb.map((s) => s.id);
    let salesWithReturns = new Set<string>();

    if (originalSaleIds.length > 0) {
      const returnLogs = await prisma.saleRecord.findMany({
          where: {
              originalSaleRecordId: { in: originalSaleIds },
              status: 'ADJUSTED_ACTIVE',
          },
          select: { originalSaleRecordId: true, returnedItemsLog: true },
      });

      returnLogs.forEach(logContainer => {
          if (logContainer.originalSaleRecordId && Array.isArray(logContainer.returnedItemsLog)) {
              const hasActiveReturns = (logContainer.returnedItemsLog as any[]).some(log => !log.isUndone);
              if (hasActiveReturns) {
                  salesWithReturns.add(logContainer.originalSaleRecordId);
              }
          }
      });
    }

    const mappedResults = originalSalesFromDb
      .map((dbRecord) => {
        const hasReturns = salesWithReturns.has(dbRecord.id);
        return mapPrismaSaleToRecordType(dbRecord, hasReturns);
      })
      .filter(Boolean) as SaleRecordType[];

    return { success: true, data: { sales: mappedResults, totalCount } };
  } catch (error: any) {
    console.error('Error fetching sale records in getAllSaleRecordsAction:', error);
    return { success: false, error: 'Failed to fetch sale records. See server logs for details.' };
  }
}



export async function getOpenCreditSalesAction(
  userId: string,
  page: number = 1,
  limit: number = 10,
  filters?: {
    customerId?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }
): Promise<{ success: boolean; data?: { sales: SaleRecordType[]; totalCount: number }; error?: string }> {
  try {
    const whereClause: Prisma.SaleRecordWhereInput = {
      createdByUserId: userId,
      isCreditSale: true,
      creditPaymentStatus: {
        in: [CreditPaymentStatusEnumSchema.Enum.PENDING, CreditPaymentStatusEnumSchema.Enum.PARTIALLY_PAID],
      },
      recordType: 'SALE',
    };

    if (filters?.customerId && filters.customerId !== 'all') {
      whereClause.customerId = filters.customerId;
    }

    const dateFilter: Prisma.DateTimeFilter = {};
    if (filters?.startDate) {
      dateFilter.gte = filters.startDate;
    }
    if (filters?.endDate) {
      dateFilter.lte = filters.endDate;
    }
    if (Object.keys(dateFilter).length > 0) {
      whereClause.date = dateFilter;
    }


     const [sales, totalCount] = await prisma.$transaction([
      prisma.saleRecord.findMany({
        where: whereClause,
        include: { 
            paymentInstallments: true, 
            customer: true,
            createdBy: { select: { username: true } }
        },
        orderBy: { date: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      prisma.saleRecord.count({ where: whereClause })
    ]);
    
    return { 
        success: true, 
        data: { 
            sales: sales.map(record => mapPrismaSaleToRecordType(record)).filter(Boolean) as SaleRecordType[],
            totalCount
        } 
    };
  } catch (error: any) {
    console.error('Error fetching open credit sales:', error);
    return { success: false, error: error.message || 'Failed to fetch open credit sales.' };
  }
}

export async function recordCreditPaymentAction(
    saleRecordId: string,
    amountBeingPaid: number,
    installmentPaymentMethod: string,
    userId: string,
    notes?: string
): Promise<{ success: boolean; data?: SaleRecordType; error?: string }> {
    if (!saleRecordId || typeof amountBeingPaid !== 'number' || amountBeingPaid <= 0 || !installmentPaymentMethod || !userId) {
        return { success: false, error: "Invalid payment details or user not authenticated." };
    }

    try {
        const updatedSaleRecordTxResult = await prisma.$transaction(async (tx) => {
            const saleRecord = await tx.saleRecord.findUnique({
                where: { id: saleRecordId },
                include: { paymentInstallments: true }
            });

            if (!saleRecord) throw new Error("Sale record not found.");
            if (!saleRecord.isCreditSale || saleRecord.recordType !== 'SALE') throw new Error("This is not an open credit sale.");
            if (saleRecord.creditPaymentStatus === CreditPaymentStatusEnumSchema.enum.FULLY_PAID) throw new Error("This credit sale is already fully paid.");

            const currentOutstanding = saleRecord.creditOutstandingAmount ?? 0;

            if (amountBeingPaid > currentOutstanding + 0.001) {
                throw new Error(`Payment amount (Rs. ${amountBeingPaid.toFixed(2)}) exceeds outstanding amount (Rs. ${currentOutstanding.toFixed(2)}).`);
            }

            await tx.paymentInstallment.create({
                data: {
                    saleRecordId: saleRecordId,
                    amountPaid: amountBeingPaid,
                    method: installmentPaymentMethod.toUpperCase(),
                    notes: notes,
                    paymentDate: new Date(),
                    recordedByUserId: userId,
                }
            });

            const newOutstandingAmount = currentOutstanding - amountBeingPaid;

            const newPaymentStatus = newOutstandingAmount <= 0.009 ?
                                     CreditPaymentStatusEnumSchema.enum.FULLY_PAID :
                                     CreditPaymentStatusEnumSchema.enum.PARTIALLY_PAID;

            return await tx.saleRecord.update({
                where: { id: saleRecordId },
                data: {
                    creditOutstandingAmount: newOutstandingAmount,
                    creditPaymentStatus: newPaymentStatus,
                    creditLastPaymentDate: new Date(),
                    amountPaidByCustomer: (saleRecord.amountPaidByCustomer || 0) + amountBeingPaid,
                },
                include: { paymentInstallments: true, customer: true, createdBy: { select: { username: true } } }
            });
        });
        const mappedData = mapPrismaSaleToRecordType(updatedSaleRecordTxResult);
        if (!mappedData) throw new Error("Failed to map updated sale record after credit payment.");
        return { success: true, data: mappedData };
    } catch (error: any) {
        console.error('Error recording credit payment:', error);
        return { success: false, error: error.message || 'Failed to record credit payment.' };
    }
}

export async function getInstallmentsForSaleAction(
    saleRecordId: string
): Promise<{ success: boolean; data?: PaymentInstallment[]; error?: string }> {
    if (!saleRecordId) {
        return { success: false, error: "Sale Record ID is required." };
    }
    try {
        const installments = await prisma.paymentInstallment.findMany({
            where: { saleRecordId: saleRecordId },
            orderBy: { paymentDate: 'asc' }
        });
        const mappedInstallments: PaymentInstallment[] = installments.map(inst => ({
            ...inst,
            id: inst.id,
            saleRecordId: inst.saleRecordId,
            paymentDate: new Date(inst.paymentDate).toISOString(),
            amountPaid: inst.amountPaid,
            method: inst.method,
            notes: inst.notes || null, 
            createdAt: inst.createdAt ? new Date(inst.createdAt).toISOString() : undefined,
            updatedAt: inst.updatedAt ? new Date(inst.updatedAt).toISOString() : undefined,
            recordedByUserId: inst.recordedByUserId,
        }));
        return { success: true, data: mappedInstallments };
    } catch (error: any) {
        console.error(`Error fetching installments for sale ${saleRecordId}:`, error);
        return { success: false, error: error.message || 'Failed to fetch payment installments.' };
    }
}

export async function undoReturnItemAction(
  input: { masterSaleRecordId: string; returnedItemDetailId: string; },
  userId: string,
): Promise<{ success: boolean; data?: SaleRecordType; error?: string }> {
  if (!userId) {
      return { success: false, error: 'User is not authenticated. Cannot undo return.' };
  }
  const validationResult = UndoReturnItemInputSchema.omit({originalSaleId: true}).extend({masterSaleRecordId: z.string()}).safeParse(input);
  if (!validationResult.success) {
    return { success: false, error: "Invalid input for undoing return: " + validationResult.error.flatten().formErrors.join(', ') };
  }
  const { masterSaleRecordId, returnedItemDetailId } = validationResult.data;

  try {
    const updatedOrPristineSaleRecord = await prisma.$transaction(async (tx) => {
      
      const masterRecord = await tx.saleRecord.findUnique({
        where: { id: masterSaleRecordId },
      });

      if (!masterRecord) {
        throw new Error("Sale record to modify not found.");
      }
      
      const pristineOriginalSale = masterRecord.originalSaleRecordId 
        ? await tx.saleRecord.findUniqueOrThrow({ where: { id: masterRecord.originalSaleRecordId } })
        : masterRecord;

      const currentLogs = (masterRecord.returnedItemsLog as unknown as ReturnedItemDetailType[]) || [];
      let logToUndo: ReturnedItemDetail | undefined;
      
      const updatedLogs = currentLogs.map(log => {
        if (log.id === returnedItemDetailId) {
          if (log.isUndone) throw new Error("This return entry has already been undone.");
          logToUndo = { ...log, isUndone: true, undoneAt: new Date().toISOString(), undoneByUserId: userId };
          return logToUndo;
        }
        return log;
      });

      if (!logToUndo) throw new Error("Return log entry to undo not found.");

      const productOfUndoneItem = await tx.product.findUnique({ where: { id: logToUndo.itemId } });
      if (productOfUndoneItem && !productOfUndoneItem.isService) {
        await tx.product.update({
            where: { id: logToUndo.itemId },
            data: { stock: { decrement: logToUndo.returnedQuantity }, updatedByUserId: userId }
        });
      }
      
      const activeReturnLogsAfterUndo = updatedLogs.filter(log => !log.isUndone);
      
      if (activeReturnLogsAfterUndo.length === 0) {
        if (masterRecord.id !== pristineOriginalSale.id) {
           await tx.saleRecord.delete({ where: { id: masterRecord.id } });
        }
        
        return tx.saleRecord.findUniqueOrThrow({
            where: { id: pristineOriginalSale.id },
            include: { paymentInstallments: true, customer: true, createdBy: {select: {username: true}} }
        });

      } else {
        const allProductsForCalc = await tx.product.findMany();
        const allDiscountSetsForCalc = await tx.discountSet.findMany({ include: { productConfigurations: true } });
        
        const pristineItems: SaleRecordItemType[] = (pristineOriginalSale.items !== Prisma.JsonNull && Array.isArray(pristineOriginalSale.items)) ? pristineOriginalSale.items as any : [];

        let itemsKeptForAdjustedBill: SaleRecordItemType[] = pristineItems.map(originalItem => {
            let quantityStillReturnedForThisProduct = 0;
            activeReturnLogsAfterUndo.forEach(log => {
                if (log.itemId === originalItem.productId) { quantityStillReturnedForThisProduct += log.returnedQuantity; }
            });
            const keptQuantity = originalItem.quantity - quantityStillReturnedForThisProduct;
            return { ...originalItem, quantity: keptQuantity };
        }).filter(item => item.quantity > 0);

        const activeDiscountSetForOriginalSale = pristineOriginalSale.activeDiscountSetId
          ? allDiscountSetsForCalc.find(ds => ds.id === pristineOriginalSale.activeDiscountSetId)
          : null;

        const keptItemsAsSaleItemsForCalc: SaleItem[] = itemsKeptForAdjustedBill.map(item => {
          const productInfo = allProductsForCalc.find(p => p.id === item.productId);
          return {
            id: item.productId,
            name: item.name,
            price: productInfo?.sellingPrice || item.priceAtSale,
            stock: productInfo?.stock || 0,
            category: productInfo?.category,
            imageUrl: productInfo?.imageUrl,
            units: (productInfo?.units as UnitDefinition | undefined) || item.units,
            defaultQuantity: productInfo?.defaultQuantity || 1,
            isActive: productInfo?.isActive || true,
            isService: productInfo?.isService || false,
            productSpecificTaxRate: productInfo?.productSpecificTaxRate,
            costPrice: productInfo?.costPrice,
            quantity: item.quantity,
            description: productInfo?.description,
            barcode: productInfo?.barcode,
            code: productInfo?.code,
          };
        });
        
        const discountResultsForKeptItems = calculateDiscountsForItems({
            saleItems: keptItemsAsSaleItemsForCalc,
            activeCampaign: activeDiscountSetForOriginalSale || null,
            allProducts: allProductsForCalc
        });

        const updatedItemsKeptForAdjustedBill = itemsKeptForAdjustedBill.map(keptItem => {
          const productDetails = allProductsForCalc.find(p => p.id === keptItem.productId);
          const originalSellingPrice = productDetails?.sellingPrice ?? keptItem.priceAtSale;
          const itemDiscountInfo = discountResultsForKeptItems.itemDiscounts.get(keptItem.productId);
          const newlyCalculatedDiscountForLine = itemDiscountInfo?.totalCalculatedDiscountForLine ?? 0;
          let newEffectivePricePaidPerUnit = originalSellingPrice;
          if (newlyCalculatedDiscountForLine > 0 && keptItem.quantity > 0) {
            newEffectivePricePaidPerUnit = originalSellingPrice - (newlyCalculatedDiscountForLine / keptItem.quantity);
          }
          return { ...keptItem, price: originalSellingPrice, priceAtSale: originalSellingPrice, effectivePricePaidPerUnit: Math.max(0, newEffectivePricePaidPerUnit), totalDiscountOnLine: newlyCalculatedDiscountForLine };
        });

        const adjSubtotalOriginalFromKept = updatedItemsKeptForAdjustedBill.reduce((sum, item) => sum + (item.priceAtSale * item.quantity), 0);
        const adjNetSubtotalFromKept = adjSubtotalOriginalFromKept - discountResultsForKeptItems.totalItemDiscountAmount - discountResultsForKeptItems.totalCartDiscountAmount;
        const currentTaxRateForAdjusted = pristineOriginalSale.taxRate ?? 0;
        
        let adjTaxAmount = 0;
        updatedItemsKeptForAdjustedBill.forEach(item => {
          const productDetails = allProductsForCalc.find(p => p.id === item.productId);
          if (!productDetails) return;
          const itemNetValueBeforeDiscount = item.priceAtSale * item.quantity;
          const itemDiscount = item.totalDiscountOnLine || 0;
          const itemNetValueAfterItemDiscount = itemNetValueBeforeDiscount - itemDiscount;
          
          let itemProportionalCartDiscount = 0;
          const subtotalNetOfItemDiscountsForCalc = adjSubtotalOriginalFromKept - discountResultsForKeptItems.totalItemDiscountAmount;
          if (subtotalNetOfItemDiscountsForCalc > 0 && discountResultsForKeptItems.totalCartDiscountAmount > 0) {
            itemProportionalCartDiscount = (itemNetValueAfterItemDiscount / subtotalNetOfItemDiscountsForCalc) * discountResultsForKeptItems.totalCartDiscountAmount;
          }
          const finalItemValueForTax = itemNetValueAfterItemDiscount - itemProportionalCartDiscount;
          const taxRateForItem = productDetails.productSpecificTaxRate ?? currentTaxRateForAdjusted;
          adjTaxAmount += Math.max(0, finalItemValueForTax) * taxRateForItem;
        });

        const adjTotalAmount = adjNetSubtotalFromKept + Math.max(0, adjTaxAmount);
        
        const dataToUpdateOnMaster: Prisma.SaleRecordUpdateInput = {
          date: new Date(), 
          items: updatedItemsKeptForAdjustedBill.map(i => ({...i, units: (i.units || {baseUnit: 'pcs', derivedUnits: []})})) as Prisma.JsonValue,
          subtotalOriginal: adjSubtotalOriginalFromKept, 
          totalItemDiscountAmount: discountResultsForKeptItems.totalItemDiscountAmount,
          totalCartDiscountAmount: discountResultsForKeptItems.totalCartDiscountAmount, 
          netSubtotal: adjNetSubtotalFromKept,
          appliedDiscountSummary: discountResultsForKeptItems.fullAppliedDiscountSummary as Prisma.JsonValue | Prisma.DbNull, 
          taxRate: currentTaxRateForAdjusted, taxAmount: adjTaxAmount, totalAmount: adjTotalAmount,
          status: 'ADJUSTED_ACTIVE',
          returnedItemsLog: updatedLogs as Prisma.JsonValue,
        };

        if (masterRecord.isCreditSale) {
            dataToUpdateOnMaster.creditOutstandingAmount = Math.max(0, adjTotalAmount - (masterRecord.amountPaidByCustomer || 0));
            dataToUpdateOnMaster.creditPaymentStatus = 
              ( (Math.max(0, adjTotalAmount - (masterRecord.amountPaidByCustomer || 0))) <= 0.009 ? 'FULLY_PAID'
              : (((masterRecord.amountPaidByCustomer || 0) > 0 || activeReturnLogsAfterUndo.length > 0) ? 'PARTIALLY_PAID'
              : 'PENDING') );
        }

        const recordToUpdateId = masterRecord.id;

        return await tx.saleRecord.update({
          where: { id: recordToUpdateId },
          data: dataToUpdateOnMaster,
          include: { paymentInstallments: true, customer: true, createdBy: {select: {username: true}} },
        });
      }
    });

    const mappedData = mapPrismaSaleToRecordType(updatedOrPristineSaleRecord, (updatedOrPristineSaleRecord.returnedItemsLog as any[])?.some(log => !log.isUndone));
    if (!mappedData) throw new Error("Failed to map updated sale record after undoing item.");
    return { success: true, data: mappedData };

  } catch (error: any) {
    console.error('Error undoing return item:', error, error.stack);
    let errorMessage = 'Failed to undo return item.';
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        errorMessage = "Record to update/delete not found during undo operation.";
    } else if (error instanceof Error) {
        errorMessage = error.message;
    }
    return { success: false, error: errorMessage };
  }
}
