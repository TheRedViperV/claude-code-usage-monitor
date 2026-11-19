import type { ClientModule } from 'claude-code'

/**
 * A transparent click layer laid over a drawn control: images take no
 * presses, so this posts the control's action to the hooks module.
 */
const Hit: ClientModule<{ action: string }> = (props, surface) => {
  surface.onPointer(e => {
    if (e.type === 'up' && (e.button ?? 'left') === 'left') surface.post({ action: props.action })
  })
  return surface.elements.Text({ children: ' '.repeat(Math.max(1, surface.columns)) })
}

export default Hit
