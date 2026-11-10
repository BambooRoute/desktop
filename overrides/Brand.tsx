import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <rect width="48" height="48" rx="14" fill="#244C38" />
    <rect x="11" y="9" width="6" height="14" rx="2" fill="#F6F8ED" />
    <rect x="11" y="26" width="6" height="13" rx="2" fill="#F6F8ED" />
    <path d="M17 22C17 14.1 26.5 8.3 38 9C37.8 17.3 28.5 23.2 17 22Z" fill="#BBD68D" />
    <path d="M19 28H28.5C33.2 28 36 30.1 36 33.5C36 36.8 33.2 39 28.5 39H19" stroke="#F6F8ED" strokeWidth="5.5" strokeLinecap="round" />
  </svg>
}

export function OfficialBrandName() {
  return <span style={{ fontSize: 17, fontWeight: 500, letterSpacing: '-0.4px' }}>Bamboo</span>
}
