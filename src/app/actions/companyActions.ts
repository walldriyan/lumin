
'use server';

import prisma from '@/lib/prisma';
import { CompanyProfileSchema } from '@/lib/zodSchemas';
import type { CompanyProfileFormData } from '@/types';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const unlinkAsync = promisify(fs.unlink);

const LOGO_UPLOAD_DIR = path.join(process.cwd(), 'public/uploads/company-logos');

export async function getAllCompanyProfilesAction(userId: string | null): Promise<{
  success: boolean;
  data?: CompanyProfileFormData[];
  error?: string;
}> {
  if (!userId) {
    return { success: false, error: "User not authenticated." };
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: { select: { name: true } } }
    });

    if (!user) {
      return { success: false, error: "User not found." };
    }

    const isSuperAdmin = user.role?.name === 'Admin';
    const whereClause: Prisma.CompanyProfileWhereInput = {};

    if (!isSuperAdmin && user.companyId) {
      // If not a super admin, they must have a company, and can only see their own
      whereClause.id = user.companyId;
    } else if (!isSuperAdmin && !user.companyId) {
      // A non-admin user without a company sees nothing
      return { success: true, data: [] };
    }
    // If Super Admin, whereClause is empty, so they see all companies.

    const profiles = await prisma.companyProfile.findMany({
      where: whereClause,
      orderBy: { name: 'asc' },
    });
    return { success: true, data: profiles as CompanyProfileFormData[] };
  } catch (error: any) {
    console.error('Error fetching company profiles:', error);
    return { success: false, error: 'Failed to fetch company profiles.' };
  }
}


export async function saveCompanyProfileAction(
  formData: FormData,
  userId: string
): Promise<{ success: boolean; data?: CompanyProfileFormData; error?: string, fieldErrors?: Record<string, string[]> }> {
  
  if (!userId) {
    return { success: false, error: 'User is not authenticated. Cannot update company profile.' };
  }
  console.log("[ACTION START] saveCompanyProfileAction invoked by user:", userId);

  const rawDataFromForm: Record<string, any> = {};
  formData.forEach((value, key) => {
    if (key !== 'logoFile' && key !== 'clearLogo') {
       rawDataFromForm[key] = value;
    }
  });
  
  const logoFile = formData.get('logoFile') as File | null;
  const clearLogo = formData.get('clearLogo') === 'true';
  console.log(`[DATA PREP] Logo File present: ${!!logoFile}, Clear Logo flag: ${clearLogo}`);

  // Handle ID from form for updates
  const profileId = formData.get('id') as string | null;
  if (profileId && profileId !== 'undefined' && profileId !== 'null') {
    rawDataFromForm.id = profileId;
  } else {
    delete rawDataFromForm.id;
  }
  
  if (logoFile) {
    rawDataFromForm.logoUrl = '';
  }
  
  console.log("[VALIDATION] Raw text data being sent to Zod:", rawDataFromForm);
  const validationResult = CompanyProfileSchema.safeParse(rawDataFromForm);
  
  if (!validationResult.success) {
    console.error("[VALIDATION FAIL] Zod validation failed:", validationResult.error.flatten().fieldErrors);
    return { success: false, error: "Validation failed. Please check the errors below.", fieldErrors: validationResult.error.flatten().fieldErrors };
  }
  const validatedTextData = validationResult.data;
  console.log("[VALIDATION SUCCESS] Zod validation passed. Validated data:", validatedTextData);

  const { id: validatedId, logoUrl: currentDbLogoUrlFromZod, ...dataToSave } = validatedTextData;

  let newLogoPath: string | null | undefined = currentDbLogoUrlFromZod;

  try {
    console.log("[FILE SYSTEM] Ensuring logo directory exists:", LOGO_UPLOAD_DIR);
    await mkdirAsync(LOGO_UPLOAD_DIR, { recursive: true });

    let oldLogoPathOnServer: string | null = null;
    if (profileId) {
        const existingProfileFromServer = await prisma.companyProfile.findUnique({
            where: { id: profileId },
            select: { logoUrl: true }
        });
        oldLogoPathOnServer = existingProfileFromServer?.logoUrl ? path.join(process.cwd(), 'public', existingProfileFromServer.logoUrl) : null;
        console.log("[FILE SYSTEM] Old logo path from DB:", oldLogoPathOnServer || "None");
    }


    if (clearLogo) {
        console.log("[FILE SYSTEM] 'clearLogo' is true. Deleting old logo if it exists.");
        newLogoPath = null;
        if (oldLogoPathOnServer && fs.existsSync(oldLogoPathOnServer)) {
            try {
                await unlinkAsync(oldLogoPathOnServer);
                console.log("[FILE SYSTEM] Successfully deleted old logo:", oldLogoPathOnServer);
            } catch (unlinkError) {
                console.error("[FILE SYSTEM ERROR] Error deleting old logo (on clearLogo):", unlinkError);
            }
        }
    } else if (logoFile) {
      console.log(`[FILE SYSTEM] New logo file detected: ${logoFile.name}. Processing...`);
      const fileBuffer = Buffer.from(await logoFile.arrayBuffer());
      const fileExtension = path.extname(logoFile.name);
      const uniqueFilename = `logo-${Date.now()}${fileExtension}`;
      const filePathOnServer = path.join(LOGO_UPLOAD_DIR, uniqueFilename);
      
      console.log(`[FILE SYSTEM] Writing new logo to: ${filePathOnServer}`);
      await writeFileAsync(filePathOnServer, fileBuffer);
      newLogoPath = `/uploads/company-logos/${uniqueFilename}`; 
      console.log(`[FILE SYSTEM] New logo path set to: ${newLogoPath}`);

      if (oldLogoPathOnServer && oldLogoPathOnServer !== path.join(process.cwd(), 'public', newLogoPath) && fs.existsSync(oldLogoPathOnServer)) {
         console.log("[FILE SYSTEM] New logo uploaded. Deleting old logo:", oldLogoPathOnServer);
         try {
            await unlinkAsync(oldLogoPathOnServer);
            console.log("[FILE SYSTEM] Successfully deleted old logo (replaced by new).");
         } catch (unlinkError) {
            console.error("[FILE SYSTEM ERROR] Error deleting old logo (on new upload):", unlinkError);
         }
      }
    }

    const finalData = {
      ...dataToSave,
      logoUrl: newLogoPath, 
      name: dataToSave.name || "My Company",
      updatedByUserId: userId,
    };
    
    let savedProfile: CompanyProfileFormData;

    if (profileId) { // This is an update
      console.log("[DB] Updating existing profile with ID:", profileId);
      savedProfile = await prisma.companyProfile.update({
        where: { id: profileId },
        data: finalData,
      });
    } else { // This is a create
       console.log("[DB] Creating new profile.");

        // Check if this is the very first company being created.
       const companyCount = await prisma.companyProfile.count();

       savedProfile = await prisma.companyProfile.create({
         data: { ...finalData, createdByUserId: userId }
       });

       // If it was the first company, assign the admin user to it.
       if (companyCount === 0) {
            const adminUser = await prisma.user.findFirst({
                where: { role: { name: 'Admin' } }
            });
            if (adminUser && !adminUser.companyId) {
                await prisma.user.update({
                    where: { id: adminUser.id },
                    data: { companyId: savedProfile.id }
                });
                console.log(`[DB] First company created. Admin user '${adminUser.username}' assigned to it.`);
            }
       }
    }
    
    console.log("[DB SUCCESS] Prisma operation successful. Profile saved:", savedProfile);
    return { success: true, data: savedProfile as CompanyProfileFormData };

  } catch (error: any) {
    console.error('[ACTION FAIL] Critical error in saveCompanyProfileAction:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return { success: false, error: `Database error: ${error.message}` };
    }
    return { success: false, error: error.message || 'An unexpected server error occurred.' };
  }
}

export async function deleteCompanyProfileAction(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Also delete the associated logo file if it exists
    const profileToDelete = await prisma.companyProfile.findUnique({ where: { id } });
    if (profileToDelete?.logoUrl) {
      const logoPath = path.join(process.cwd(), 'public', profileToDelete.logoUrl);
      if (fs.existsSync(logoPath)) {
        await unlinkAsync(logoPath);
        console.log(`[DELETE] Deleted logo file: ${logoPath}`);
      }
    }

    await prisma.companyProfile.delete({ where: { id } });
    console.log(`[DELETE] Deleted company profile with ID: ${id}`);
    return { success: true };
  } catch (error) {
    console.error(`Error deleting company profile ${id}:`, error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { success: false, error: 'Company profile to delete not found.' };
    }
    return { success: false, error: 'Failed to delete company profile.' };
  }
}
