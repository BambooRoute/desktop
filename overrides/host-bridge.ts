export async function receiveBambooBridge(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { process.removeListener('message', receive); reject(new Error('Bamboo desktop connection timed out')) }, 15_000)
    const receive = (message: unknown) => {
      if (typeof message !== 'object' || !message || !('type' in message) || message.type !== 'bamboo-bridge') return
      if (!('url' in message) || typeof message.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.url) ||
        !('token' in message) || typeof message.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(message.token)) {
        clearTimeout(timer)
        process.removeListener('message', receive)
        reject(new Error('Bamboo desktop connection is invalid'))
        return
      }
      Object.defineProperty(globalThis, Symbol.for('bamboo.desktop.bridge'), { value: Object.freeze({ url: message.url, token: message.token }) })
      clearTimeout(timer)
      process.removeListener('message', receive)
      resolve()
    }
    process.on('message', receive)
  })
}
