import Link from "next/link";
import BulkUpload from "./BulkUpload";

export default function BulkUploadPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Import from library</h1>
        <p className="text-sm text-stone-500">
          Pick a stack of photos already on your phone. We&apos;ll convert HEIC, remove backgrounds, AI-tag in
          the background, and save each as its own item — sent to Needs Review by default.
        </p>
      </div>
      <BulkUpload />
    </div>
  );
}
