import WishlistForm from "../WishlistForm";

export default function NewWishlistPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-blush-700">Add to wishlist</h1>
        <p className="text-sm text-stone-500">Save something you love, want, or need.</p>
      </div>
      <WishlistForm />
    </div>
  );
}
