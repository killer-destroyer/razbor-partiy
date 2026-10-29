import { Notification } from 'electron'

export function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, silent: false })
  if (onClick) notification.on('click', onClick)
  notification.show()
}
