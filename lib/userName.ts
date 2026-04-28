// First name from a user object. Falls back to the local part of the email,
// or null if neither is usable.
export function firstNameFromUser(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string | null {
  if (!user) return null;
  const fromName = (user.name ?? "").trim();
  if (fromName) return fromName.split(/\s+/)[0];
  const email = (user.email ?? "").trim();
  if (!email) return null;
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim() ?? "";
  if (!local) return null;
  const word = local.split(/\s+/)[0];
  if (!word) return null;
  return word[0].toUpperCase() + word.slice(1).toLowerCase();
}

// "Eryn's Closet" / "Closet" depending on whether we have a name.
// Names already ending in 's' get just an apostrophe ("Chris' Closet").
export function possessiveTitle(noun: string, firstName: string | null): string {
  if (!firstName) return noun;
  const apos = firstName.endsWith("s") ? "'" : "'s";
  return `${firstName}${apos} ${noun}`;
}
