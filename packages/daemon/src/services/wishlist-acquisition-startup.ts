import type { WishlistService } from "./wishlist-service.js";

/** Do not construct/expose routes until durable owned/wishlist overlaps are reconciled. */
export async function createAfterWishlistAcquisitionRecovery<Value>(
  wishlistService: Pick<WishlistService, "reconcileAcquisitions">,
  createApplication: () => Value | Promise<Value>,
): Promise<{ application: Value; reconciledEntries: number }> {
  const reconciledEntries = await wishlistService.reconcileAcquisitions();
  const application = await createApplication();
  return { application, reconciledEntries };
}
