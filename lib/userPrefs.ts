// Cookie-backed user preferences. Anything the dashboard server
// component needs cheap access to (home city for the weather card,
// future toggles) lands here.
//
// Cookies are scoped per-browser, so the two seeded accounts each get
// their own pref by virtue of being on different devices in practice.
// Keeping this out of the DB means no migrations and the user can clear
// the value just by clearing site data.

import { cookies } from "next/headers";

const HOME_CITY = "wardrobe.homeCity";
const ONE_YEAR = 60 * 60 * 24 * 365;

export type Prefs = {
  homeCity: string | null;
};

export async function getPrefs(): Promise<Prefs> {
  const jar = await cookies();
  const homeCity = jar.get(HOME_CITY)?.value?.trim() || null;
  return { homeCity };
}

export async function setHomeCity(value: string): Promise<void> {
  const jar = await cookies();
  const trimmed = value.trim();
  if (!trimmed) {
    jar.delete(HOME_CITY);
    return;
  }
  jar.set(HOME_CITY, trimmed.slice(0, 80), {
    maxAge: ONE_YEAR,
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
}
