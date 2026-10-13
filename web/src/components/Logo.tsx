export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2" y="4" width="28" height="24" rx="3" fill="#11151f" stroke="#2b3242" strokeWidth="1.5" />
      <rect x="5" y="7" width="22" height="18" rx="1.5" fill="#0b0e14" />
      {/* six Spectra colors as a little mosaic */}
      <rect x="6" y="8" width="6.5" height="7.5" fill="#e5484d" />
      <rect x="12.7" y="8" width="6.5" height="7.5" fill="#f5d90a" />
      <rect x="19.4" y="8" width="6.5" height="7.5" fill="#30a46c" />
      <rect x="6" y="15.7" width="6.5" height="7.5" fill="#3b82f6" />
      <rect x="12.7" y="15.7" width="6.5" height="7.5" fill="#e6e8ee" />
      <rect x="19.4" y="15.7" width="6.5" height="7.5" fill="#11151f" />
    </svg>
  );
}
