type BrandSealIconProps = {
  className?: string;
  size?: number | string;
};

export function BrandSealIcon({ className, size = 44 }: BrandSealIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
    >
      <rect width="512" height="512" rx="160" fill="#13211E" />
      <path d="M112 154C112 128 128 118 152 116L360 116C384 118 400 128 400 154L396 160C394 164 390 166 384 166L128 166C122 166 118 164 116 160Z" fill="#F3F0E8" />
      <rect x="164" y="198" width="184" height="16" rx="4" fill="#F3F0E8" />
      <rect x="180" y="150" width="22" height="226" rx="4" fill="#F3F0E8" />
      <rect x="310" y="150" width="22" height="226" rx="4" fill="#F3F0E8" />
      <path d="M148 392Q256 308 364 392" stroke="#B88A4A" strokeWidth="20" strokeLinecap="round" />
    </svg>
  );
}