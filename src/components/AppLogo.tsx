interface AppLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AppLogoProps['size']>, string> = {
  xs: 'w-8 h-8',
  sm: 'w-10 h-10',
  md: 'w-12 h-12',
  lg: 'w-14 h-14 sm:w-16 sm:h-16',
  xl: 'w-20 h-20',
};

export function AppLogo({ size = 'md', className = '' }: AppLogoProps) {
  return (
    <img
      src="/assets/aistudio/file_0000000043908211ab498b6aee2c83f0_adb48a40.png"
      alt="Logo EDU RUN ARENA 3D"
      referrerPolicy="no-referrer"
      draggable={false}
      className={`${SIZE_CLASSES[size]} shrink-0 object-contain select-none drop-shadow-[0_6px_14px_rgba(8,18,38,0.65)] ${className}`}
    />
  );
}
