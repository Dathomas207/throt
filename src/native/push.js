// Push notifications for the iPhone app. Scaffold only: this file can ask for permission
// and receive the device token, but nothing calls it yet and the server cannot send a
// push yet. docs/ios-build.md ("Push notifications: what is still missing") lists the
// rest: the Push Notifications capability in Xcode, an APNs key, a table of device
// tokens, and a sender.
//
// Nothing here runs on the website. Every function answers 'unsupported' there.
//
//   import { registerForPush } from './native/push.js'
//   const stop = await registerForPush({
//     onToken: (token) => api.post('/push/devices', { token, platform: 'ios' }),   // route does not exist yet
//     onNotification: (n) => { ... },   // arrived while Trot was open
//     onOpen: (n) => { ... },           // the person tapped it
//     onError: (message) => { ... },
//   })
import { isNative } from './platform.js'

let pluginPromise = null
function plugin() {
  if (!pluginPromise) pluginPromise = import('@capacitor/push-notifications').then((m) => m.PushNotifications)
  return pluginPromise
}

export const pushSupported = () => isNative

// 'granted', 'denied', 'prompt' (not asked yet) or 'unsupported'. Never shows a dialog.
export async function pushPermission() {
  if (!isNative) return 'unsupported'
  try { const r = await (await plugin()).checkPermissions(); return r.receive === 'granted' ? 'granted' : r.receive === 'denied' ? 'denied' : 'prompt' } catch (e) { return 'unsupported' }
}

// Shows the iOS permission dialog the first time. Call it from a button the person tapped,
// after saying what Trot will send, not at launch.
export async function requestPushPermission() {
  if (!isNative) return 'unsupported'
  try { const r = await (await plugin()).requestPermissions(); return r.receive === 'granted' ? 'granted' : 'denied' } catch (e) { return 'unsupported' }
}

// Asks for permission if needed, then registers with Apple. onToken gets the APNs device
// token as a hex string. Answers a function that removes the listeners.
// Until the Push Notifications capability is added in Xcode, registering fails and onError
// is called with Apple's message ("no valid aps-environment entitlement"). That is expected.
export async function registerForPush({ onToken, onNotification, onOpen, onError } = {}) {
  if (!isNative) { if (onError) onError('Push notifications only work in the iPhone app.'); return () => {} }
  const push = await plugin()
  const handles = await Promise.all([
    push.addListener('registration', (t) => { if (onToken) onToken(t.value) }),
    push.addListener('registrationError', (e) => { if (onError) onError((e && e.error) || 'Could not register for notifications.') }),
    push.addListener('pushNotificationReceived', (n) => { if (onNotification) onNotification(n) }),
    push.addListener('pushNotificationActionPerformed', (a) => { if (onOpen) onOpen(a.notification) }),
  ])
  const stop = () => { for (const h of handles) { try { h.remove() } catch (e) { /* already removed */ } } }
  let state = await pushPermission()
  if (state === 'prompt') state = await requestPushPermission()
  if (state !== 'granted') { if (onError) onError('Notifications are turned off for Trot.'); return stop }
  try { await push.register() } catch (e) { if (onError) onError((e && e.message) || 'Could not register for notifications.') }
  return stop
}

// Stops this phone receiving pushes. The server should also forget the token.
export async function unregisterFromPush() {
  if (!isNative) return
  try { await (await plugin()).unregister() } catch (e) { /* was not registered */ }
}
