// Icon vocabulary adapted from the reference Hadlaan Residence prototype
// (app.html's own ICONS map) so the built app matches its visual language.
const ICONS: Record<string, string> = {
  dashboard: '<path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z"/>',
  inbox: '<path d="M4 12h4.5l1.5 3h4l1.5-3H20"/><path d="M4 12 6 5h12l2 7"/><path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="17" cy="8.5" r="2.6"/><path d="M15.2 14c3 .3 5.3 2.6 5.3 6"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.2 2.2L16 9"/>',
  housekeeping: '<path d="M4 21V9l8-5 8 5v12"/><path d="M9 21v-7h6v7"/>',
  kitchen: '<path d="M6 3v6a3 3 0 0 0 3 3v9M6 3v9M9 3v6"/><path d="M17 3c-1.7 0-3 2-3 5s1 5 3 5v8"/>',
  inventory: '<path d="M3 8 12 3l9 5-9 5-9-5Z"/><path d="M3 8v9l9 5 9-5V8"/><path d="M12 13v9"/>',
  purchasing: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M2.5 3h2.5l2.4 12.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6"/>',
  maintenance: '<path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.2 2.2-2-2 2.2-2.2Z"/>',
  vehicles: '<path d="M3 16V9l2.5-5h9L17 9"/><rect x="1.5" y="9" width="21" height="7" rx="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
  garden: '<path d="M12 21V9"/><path d="M12 13c-4 0-7-3-7-7 4 0 7 3 7 7Z"/><path d="M12 10c4 0 7-3 7-7-4 0-7 3-7 7Z"/>',
  guests: '<circle cx="8.5" cy="8" r="3"/><circle cx="16" cy="8.5" r="2.6"/><path d="M2.5 20c0-3.4 2.7-5.8 6-5.8s6 2.4 6 5.8"/><path d="M13.7 14.4c2.7.4 4.8 2.6 4.8 5.6"/>',
  events: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/><path d="M8.5 14.5h2M13.5 14.5h2M8.5 17.5h2"/>',
  expenses: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.3 15c0 1.4 1.3 2.3 2.9 2.3 1.9 0 2.9-1 2.9-2.2 0-3-5.6-1.6-5.6-4.5 0-1.3 1.2-2.1 2.8-2.1 1.4 0 2.6.7 2.8 2"/>',
  documents: '<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  reports: '<path d="M4 20V10M11 20V4M18 20v-7"/><path d="M2.5 20h19"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.5-2.4.8a7.6 7.6 0 0 0-2.6-1.5L14 2h-4l-.4 2.3a7.6 7.6 0 0 0-2.6 1.5l-2.4-.8-2 3.5 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.5 2.4-.8a7.6 7.6 0 0 0 2.6 1.5L10 22h4l.4-2.3a7.6 7.6 0 0 0 2.6-1.5l2.4.8 2-3.5-2-1.5Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 3h16l-2-3Z"/><path d="M9.5 21a2.5 2.5 0 0 0 5 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="M5 12.5 10 17 19 7"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9"/>',
  alertTriangle: '<path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 10v4.2"/><circle cx="12" cy="17.2" r="0.4" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.7" r="0.4" fill="currentColor"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  car: '<path d="M3 16V9l2.5-5h9L17 9"/><rect x="1.5" y="9" width="21" height="7" rx="2"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.6 2.1"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  star: '<path d="m12 3 2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6L12 3Z"/>',
  patrol: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.6 7.5 9 4.3-1.4 7.5-4.5 7.5-9V6L12 3Z"/><path d="m8.7 12.2 2.3 2.3 4.3-4.7"/>',
};

export function Icon({
  name,
  className = "h-[18px] w-[18px]",
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const inner = ICONS[name];
  if (!inner) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
