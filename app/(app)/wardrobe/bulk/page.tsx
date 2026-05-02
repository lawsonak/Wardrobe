import Link from "next/link";
import BulkUpload from "./BulkUpload";

export default function BulkUploadPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/wardrobe" className="text-sm text-blush-600 hover:underline">← Closet</Link>
        <h1 className="mt-1 font-display text-3xl text-blush-700">Import from library</h1>
        <p className="text-sm text-stone-500">
          A short three-step flow: pick photos, watch them upload + tag + cut out, then review.
          Already-uploaded photos are safe even if you close the tab mid-batch.
        </p>
      </div>
      <BulkUpload />
    </div>
  );
}
