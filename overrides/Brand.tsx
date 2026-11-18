import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <img className="bamboo-brand-mark" src="./assets/bamboo/mark.svg" width={size} height={size} alt="" />
}

export function OfficialBrandName() {
  return <span className="bamboo-brand-name">Bamboo <span>Desktop</span></span>
}
