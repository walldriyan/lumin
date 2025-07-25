
'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useDispatch, useSelector } from 'react-redux';
import {
  getAllProductsAction,
  createProductAction,
  updateProductAction,
  deleteProductAction,
} from '@/app/actions/productActions';
import {
  initializeAllProducts,
  _internalAddNewProduct,
  _internalUpdateProduct,
  _internalDeleteProduct,
  selectAllProducts,
} from '@/store/slices/saleSlice';
import { selectCurrentUser } from '@/store/slices/authSlice';
import type { AppDispatch } from '@/store/store';
import type { Product as ProductType, ProductFormData } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ProductForm } from '@/components/dashboard/ProductForm';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, PlusCircle, Edit3, Trash2, PackageSearch, RefreshCw, ImageOff, CheckCircle, XCircle, Sigma, Search } from 'lucide-react';
import Image from 'next/image';
import { getDisplayQuantityAndUnit } from '@/lib/unitUtils';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';


interface LastSuccessfulSubmission {
  id: string;
  name: string;
}

export default function ProductManagementPage() {
  const dispatch: AppDispatch = useDispatch();
  const { toast } = useToast();
  const currentUser = useSelector(selectCurrentUser);
  const products = useSelector(selectAllProducts);

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [isProductSheetOpen, setIsProductSheetOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductType | null>(null);
  const [productToDelete, setProductToDelete] = useState<ProductType | null>(null);
  const [productFormError, setProductFormError] = useState<string | null>(null);
  const [productFormFieldErrors, setProductFormFieldErrors] = useState<Record<string, string[]> | undefined>(undefined);
  const [lastSuccessfulSubmission, setLastSuccessfulSubmission] = useState<LastSuccessfulSubmission | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [showServicesOnly, setShowServicesOnly] = useState(false);


  const fetchProducts = useCallback(async () => {
    if (!currentUser?.id) {
        setIsLoading(false);
        return;
    }
    setIsLoading(true);
    setLastSuccessfulSubmission(null); 
    const result = await getAllProductsAction(currentUser.id);
    if (result.success && result.data) {
      dispatch(initializeAllProducts(result.data));
    } else {
      toast({
        title: 'Error Fetching Products',
        description: `${result.error || 'Could not load products.'} ${result.detailedError ? `Details: ${result.detailedError}` : ''}`,
        variant: 'destructive',
        duration: 7000,
      });
    }
    setIsLoading(false);
  }, [dispatch, toast, currentUser]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const handleServicesToggle = (checked: boolean) => {
    setShowServicesOnly(checked);
    if (checked) {
      setShowOutOfStock(false);
    }
  };

  const handleOutOfStockToggle = (checked: boolean) => {
    setShowOutOfStock(checked);
    if (checked) {
      setShowServicesOnly(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const lowerSearchTerm = searchTerm.toLowerCase();

    const searchedProducts = products.filter(p =>
      p.name.toLowerCase().includes(lowerSearchTerm) ||
      (p.code && p.code.toLowerCase().includes(lowerSearchTerm)) ||
      (p.category && p.category.toLowerCase().includes(lowerSearchTerm))
    );

    if (showServicesOnly) {
      return searchedProducts.filter(p => p.isService);
    }

    if (showOutOfStock) {
      return searchedProducts.filter(p => !p.isService && p.stock <= 0);
    }

    return searchedProducts;
  }, [products, searchTerm, showOutOfStock, showServicesOnly]);

  const summary = useMemo(() => {
    const totalProducts = filteredProducts.length;
    const totalUnits = filteredProducts.reduce((sum, p) => sum + (p.isService ? 0 : p.stock), 0);
    const totalCost = filteredProducts.reduce((sum, p) => sum + (p.costPrice || 0) * (p.isService ? 0 : p.stock), 0);
    const totalValue = filteredProducts.reduce((sum, p) => sum + p.sellingPrice * (p.isService ? 0 : p.stock), 0);
    const potentialProfit = totalValue - totalCost;

    return {
        totalProducts,
        totalUnits,
        totalCost,
        totalValue,
        potentialProfit,
    };
  }, [filteredProducts]);

  const resetFormStateAndPrepareForNew = () => {
    setEditingProduct(null);
    setProductFormError(null);
    setProductFormFieldErrors(undefined);
    setLastSuccessfulSubmission(null); 
  };

  const handleAddProduct = () => {
    resetFormStateAndPrepareForNew();
    setIsProductSheetOpen(true);
  };

  const handleEditProduct = (product: ProductType) => {
    resetFormStateAndPrepareForNew(); 
    setEditingProduct(product);
    setIsProductSheetOpen(true);
  };

  const handleDeleteProduct = (product: ProductType) => {
    setProductToDelete(product);
  };

  const confirmDeleteProduct = async () => {
    if (!productToDelete) return;
    setIsSubmitting(true);
    const result = await deleteProductAction(productToDelete.id);
    if (result.success) {
      dispatch(_internalDeleteProduct({ id: productToDelete.id }));
      toast({ title: 'Product Deleted', description: `"${productToDelete.name}" has been deleted.` });
    } else {
      toast({ title: 'Error Deleting Product', description: result.error, variant: 'destructive' });
    }
    setProductToDelete(null);
    setIsSubmitting(false);
  };

  const handleProductFormSubmit = async (data: ProductFormData, productId?: string): Promise<{success: boolean, error?: string, fieldErrors?: Record<string, string[]>}> => {
    if (!currentUser?.id) {
      const errorMsg = "User not authenticated. Cannot save product.";
      setProductFormError(errorMsg);
      return { success: false, error: errorMsg };
    }
    
    setIsSubmitting(true);
    setProductFormError(null);
    setProductFormFieldErrors(undefined);
    
    let result;
    const isUpdating = !!productId;

    if (isUpdating) {
      result = await updateProductAction(productId!, data, currentUser.id);
      if (result.success && result.data) {
        dispatch(_internalUpdateProduct(result.data));
        toast({ title: 'Product Updated', description: `"${result.data.name}" has been updated.` });
        setLastSuccessfulSubmission({ id: result.data.id, name: result.data.name });
        setEditingProduct(result.data); // Keep editing form open with new data
        setProductFormError(null);
        setProductFormFieldErrors(undefined);
      }
    } else {
      result = await createProductAction(data, currentUser.id);
      if (result.success && result.data) {
        dispatch(_internalAddNewProduct(result.data));
        toast({ title: 'Product Created', description: `"${result.data.name}" has been added.` });
        setLastSuccessfulSubmission({ id: result.data.id, name: result.data.name });
        setEditingProduct(null); 
        setProductFormError(null);
        setProductFormFieldErrors(undefined);
      }
    }
    
    setIsSubmitting(false);

    if (!result.success) {
        setProductFormError(result.error || 'An unexpected error occurred.');
        setProductFormFieldErrors(result.fieldErrors);
        setLastSuccessfulSubmission(null); 
    }
    return {success: result.success, error: result.error, fieldErrors: result.fieldErrors};
  };
  
  const handleSheetOpenChange = (open: boolean) => {
    setIsProductSheetOpen(open);
    if (!open) {
      resetFormStateAndPrepareForNew(); 
    }
  };
  
  const handleSwitchToAddNewInForm = () => {
    resetFormStateAndPrepareForNew(); 
  };

  return (
      <div className="flex flex-col flex-1 p-4 md:p-6 bg-gradient-to-br from-background to-secondary text-foreground">
        <header className="mb-6 md:mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center space-x-3">
             <Button asChild variant="outline" className="border-primary text-primary hover:bg-primary hover:text-primary-foreground self-start sm:self-center">
                <Link href="/dashboard">
                  <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
                </Link>
             </Button>
            <h1 className="text-2xl md:text-3xl font-bold text-primary">
              Product Management
            </h1>
          </div>
          <div className="flex space-x-2 self-end sm:self-center">
            <Button onClick={fetchProducts} variant="outline" className="border-accent text-accent hover:bg-accent hover:text-accent-foreground" disabled={isLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
            <Button onClick={handleAddProduct} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <PlusCircle className="mr-2 h-4 w-4" /> Add Product
            </Button>
          </div>
        </header>

        <Card className="bg-card border-border shadow-xl flex-1">
          <CardHeader>
            <CardTitle className="text-2xl text-card-foreground">Product List</CardTitle>
            <CardDescription className="text-muted-foreground">
              View, add, edit, or delete products in your inventory. Use the filters below to refine your search.
            </CardDescription>
            <div className="pt-4 flex flex-col sm:flex-row gap-4 items-center">
              <div className="relative flex-grow w-full">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                      placeholder="Search by name, code, or category..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 bg-input border-border focus:ring-primary w-full"
                  />
              </div>
              <div className="flex items-center space-x-4 flex-shrink-0">
                  <div className="flex items-center space-x-2">
                      <Switch id="show-out-of-stock" checked={showOutOfStock} onCheckedChange={handleOutOfStockToggle} />
                      <Label htmlFor="show-out-of-stock" className="text-sm">Out of Stock</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                      <Switch id="show-services-only" checked={showServicesOnly} onCheckedChange={handleServicesToggle} />
                      <Label htmlFor="show-services-only" className="text-sm">Services Only</Label>
                  </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && products.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={`skel-${i}`} className="flex items-center space-x-4 p-4 border-b border-border/30">
                  <Skeleton className="h-12 w-12 rounded-md bg-muted/50" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4 rounded bg-muted/50" />
                    <Skeleton className="h-3 w-1/2 rounded bg-muted/50" />
                  </div>
                  <Skeleton className="h-8 w-20 rounded-md bg-muted/50" />
                </div>
              ))
            ) : !isLoading && filteredProducts.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <PackageSearch className="mx-auto h-12 w-12 mb-4 text-primary" />
                <p className="text-lg font-medium">No products found matching your criteria.</p>
                <p className="text-sm">Try adjusting your search or filter settings.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-border/50 hover:bg-muted/20">
                      <TableHead className="w-16 text-muted-foreground"></TableHead>
                      <TableHead className="text-muted-foreground">Name</TableHead>
                      <TableHead className="text-muted-foreground">Code</TableHead>
                      <TableHead className="text-muted-foreground">Category</TableHead>
                      <TableHead className="text-right text-muted-foreground">Sell Price</TableHead>
                      <TableHead className="text-right text-muted-foreground">Stock</TableHead>
                      <TableHead className="text-center text-muted-foreground">Status</TableHead>
                      <TableHead className="text-center text-muted-foreground">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => {
                      const { displayQuantity: stockDisplayQty, displayUnit: stockDisplayUnit } = getDisplayQuantityAndUnit(product.stock, product.units);
                      return (
                        <TableRow key={product.id} className="border-b-border/30 hover:bg-muted/10">
                          <TableCell>
                             <div className="relative w-12 h-12">
                              {product.imageUrl ? (
                                <Image
                                  src={product.imageUrl}
                                  alt={product.name}
                                  width={48}
                                  height={48}
                                  className="rounded-md object-cover aspect-square"
                                  data-ai-hint={`${product.category || ''} ${product.name.split(' ')[0] || ''}`}
                                  onError={(e) => {
                                      const target = e.target as HTMLImageElement;
                                      target.style.display = 'none';
                                      const fallback = target.nextElementSibling as HTMLElement;
                                      if (fallback && fallback.classList.contains('image-fallback-icon-container')) {
                                      fallback.classList.remove('hidden');
                                      }
                                  }}
                                />
                              ) : null}
                              <div className={`image-fallback-icon-container w-12 h-12 rounded-md bg-muted flex items-center justify-center text-muted-foreground text-xs ${product.imageUrl ? 'hidden' : ''}`}>
                                <ImageOff className="h-5 w-5" />
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium text-card-foreground">{product.name}</TableCell>
                          <TableCell className="text-card-foreground text-xs">{product.code || 'N/A'}</TableCell>
                          <TableCell className="text-card-foreground">{product.category || 'N/A'}</TableCell>
                          <TableCell className="text-right text-card-foreground">Rs. {(product.sellingPrice ?? 0).toFixed(2)}</TableCell>
                           <TableCell className="text-right text-card-foreground">
                            {product.isService ? (
                              <Badge variant="outline">Service</Badge>
                            ) : (
                              <div>
                                <span>{`${product.stock} ${product.units.baseUnit}`}</span>
                                {stockDisplayUnit !== product.units.baseUnit && (
                                  <span className="block text-xs text-muted-foreground">
                                    (Equals: {stockDisplayQty} {stockDisplayUnit})
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            {product.isActive ? (
                              <Badge variant="default" className="bg-green-500/80 hover:bg-green-600 text-white text-xs">
                                <CheckCircle className="mr-1 h-3 w-3" /> Active
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="bg-red-500/80 hover:bg-red-600 text-white text-xs">
                                <XCircle className="mr-1 h-3 w-3" /> Disabled
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center space-x-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEditProduct(product)} className="h-8 w-8 text-blue-500 hover:text-blue-600">
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(product)} className="h-8 w-8 text-red-500 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
          <CardFooter className="mt-4 border-t border-border/30 pt-2">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1" className="border-b-0">
                <AccordionTrigger className="text-xl font-semibold text-card-foreground hover:no-underline [&>svg]:text-primary p-4 rounded-lg data-[state=open]:bg-primary/10">
                  <Sigma className="mr-3 h-5 w-5 text-primary" />
                  Inventory Financial Snapshot (Filtered)
                </AccordionTrigger>
                <AccordionContent>
                  <div className="w-full pt-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="p-4 bg-muted/30 rounded-lg text-center">
                          <p className="text-sm text-muted-foreground">Total Unique Products</p>
                          <p className="text-2xl font-bold">{summary.totalProducts}</p>
                      </div>
                      <div className="p-4 bg-muted/30 rounded-lg text-center">
                          <p className="text-sm text-muted-foreground">Total Units in Stock</p>
                          <p className="text-2xl font-bold">{summary.totalUnits.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="rounded-lg border border-red-500/30 bg-red-950/20 p-4">
                          <h4 className="text-md font-semibold text-red-300 mb-2">Inventory Investment (Cost Basis)</h4>
                          <div className="flex justify-between items-center text-2xl">
                              <span className="text-muted-foreground text-lg">Total Cost:</span>
                              <span className="font-bold text-red-400">Rs. {summary.totalCost.toFixed(2)}</span>
                          </div>
                      </div>
                      <div className="rounded-lg border border-green-500/30 bg-green-950/20 p-4">
                          <h4 className="text-md font-semibold text-green-300 mb-2">Inventory Value (Retail Basis)</h4>
                          <div className="flex justify-between items-center text-2xl">
                              <span className="text-muted-foreground text-lg">Total Retail Value:</span>
                              <span className="font-bold text-green-400">Rs. {summary.totalValue.toFixed(2)}</span>
                          </div>
                      </div>
                    </div>
                    
                    <div className="mt-6 pt-4 border-t-2 border-primary/50">
                      <div className="flex justify-between items-center text-xl">
                          <span className="font-bold text-primary flex items-center"><Sigma className="mr-2 h-5 w-5"/> Gross Potential Profit</span>
                          <span className="font-bold text-primary text-2xl">Rs. {summary.potentialProfit.toFixed(2)}</span>
                      </div>
                      <p className="text-xs text-right text-muted-foreground mt-1">(Retail Value - Cost Value)</p>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardFooter>
        </Card>

        {isProductSheetOpen && (
          <Sheet open={isProductSheetOpen} onOpenChange={handleSheetOpenChange}>
            <SheetContent className="sm:max-w-3xl w-full md:w-[60vw] max-h-screen flex flex-col p-0 bg-card border-border shadow-xl overflow-hidden">
              <SheetHeader className="p-6 pb-4 border-b border-border">
                <SheetTitle className="text-card-foreground">{editingProduct ? 'Edit Product' : 'Add New Product'}</SheetTitle>
                <SheetDescription className="text-muted-foreground">
                  {editingProduct ? `Update details for ${editingProduct.name}.` : 'Fill in the details for the new product.'}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <ProductForm
                  key={editingProduct?.id || lastSuccessfulSubmission?.id || 'new-product-form'} 
                  product={editingProduct}
                  onSubmit={handleProductFormSubmit}
                  isLoading={isSubmitting}
                  onCancel={() => setIsProductSheetOpen(false)}
                  formError={productFormError}
                  fieldErrors={productFormFieldErrors}
                  onSwitchToAddNew={handleSwitchToAddNewInForm}
                  submissionDetails={lastSuccessfulSubmission}
                />
              </div>
            </SheetContent>
          </Sheet>
        )}

        {productToDelete && (
          <AlertDialog open={!!productToDelete} onOpenChange={() => setProductToDelete(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure you want to delete this product?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete "{productToDelete.name}".
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setProductToDelete(null)} disabled={isSubmitting}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteProduct} disabled={isSubmitting} className="bg-destructive hover:bg-destructive/90">
                  {isSubmitting ? "Deleting..." : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
  );
}
