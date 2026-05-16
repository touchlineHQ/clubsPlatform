/** Maps router pathnames to human-readable page titles used in the
 *  breadcrumb header and the mobile bar's subtitle line. */
const PAGE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/about': 'About Us',
  '/teams': 'Teams',
  '/fixtures': 'Fixtures & Results',
  '/register': 'Register & Pay',
  '/committee': 'Committee & Staff',
  '/news': 'Club News',
  '/gallery': 'Gallery',
  '/matchday': 'Matchday Info',
  '/contact': 'Contact',
  '/customise': 'Site Admin',
  '/admin/users': 'Manage Users',
  '/admin/payments': 'Payments',
  '/admin/secrets': 'API Secrets',
  '/admin/bookings': 'Booking Requests',
  '/bookings': 'Request a Pitch',
  '/schedule': 'Pitch Schedule',
  '/my-registrations': 'My Registrations',
};

/** Pick a friendly title for `pathname`, falling back to the longest prefix
 *  match for nested routes (e.g. /teams/.../... → "Teams") and '' when nothing
 *  matches. */
export function currentPageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const match = Object.keys(PAGE_TITLES)
    .filter(p => p !== '/' && pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : '';
}

/** Take the first letter of the first two whitespace-separated words of
 *  `name` and uppercase them. Used for the circular user-chip avatar. */
export function userInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
