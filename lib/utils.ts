import type { Updater } from '@tanstack/vue-table'
import type { Ref } from 'vue'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function valueUpdater<T extends Updater<any>>(updaterOrValue: T, ref: Ref) {
  ref.value
    = typeof updaterOrValue === 'function'
      ? updaterOrValue(ref.value)
      : updaterOrValue
}

/**
 * Gets a signed URL for a receipt and determines if it's an image
 * @param client Supabase client instance
 * @param receiptUrl The storage path to the receipt
 * @returns Object containing the signed URL and whether it's an image
 */
export const getReceiptSignedUrl = async (
  client: any,
  receiptUrl: string
): Promise<{ signedUrl: string | null; isImage: boolean }> => {
  // Early return if no receipt URL provided
  if (!receiptUrl) return { signedUrl: null, isImage: false };
  
  try {
    // Ensure client is properly initialized before using
    if (!client || !client.storage) {
      console.error('Invalid Supabase client');
      return { signedUrl: null, isImage: false };
    }
    
    const { data, error } = await client.storage
      .from('receipts')
      .createSignedUrl(receiptUrl, 60);
    
    if (error) {
      console.error('Supabase storage error:', error);
      throw error;
    }
    
    // Helper function defined within the same module or imported
    const isImage = isImageFile(receiptUrl);
    
    return {
      signedUrl: data?.signedUrl || null,
      isImage
    };
  } catch (err) {
    console.error('Error getting signed URL:', err);
    return { signedUrl: null, isImage: false };
  }
};

/**
 * Determines if a file is an image based on its extension
 */
export function isImageFile(filename: string): boolean {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
  const lowerCaseFilename = filename.toLowerCase();
  return imageExtensions.some(ext => lowerCaseFilename.endsWith(ext));
}