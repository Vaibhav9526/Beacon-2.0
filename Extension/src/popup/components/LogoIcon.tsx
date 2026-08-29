import logoSrc from '../../../icons/beacon-logo.png'

interface LogoIconProps {
  className?: string
}

export function LogoIcon({ className = 'w-10 h-10' }: LogoIconProps) {
  return (
    <img
      src={logoSrc}
      alt=""
      draggable={false}
      className={`block shrink-0 rounded-xl object-cover ${className}`}
    />
  )
}
