import AddItemForm from "./AddItemForm";

export default function NewItemPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-blush-700">Add a piece</h1>
        <p className="text-sm text-stone-500">Snap a photo and tag it however you like.</p>
      </div>
      <AddItemForm />
    </div>
  );
}
