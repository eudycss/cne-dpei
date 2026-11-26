/**
 * Aviso por Telegram al chat privado de quien administra el sistema (no a los
 * grupos de técnicos). Usa TELEGRAM_BOT_TOKEN y TELEGRAM_DEPLOY_CHAT_ID
 * (secretos de GitHub). Si faltan, solo lo deja en el log: el aviso nunca hace
 * fallar el workflow.
 *
 * Uso: node infra/deploy/telegram.mjs "texto"   (o el texto por stdin)
 */

const LIMITE = 3900; // Telegram acepta 4096 caracteres por mensaje.

export async function avisar(texto, { token, chatId, fetch: f = fetch } = {}) {
  if (!token || !chatId) {
    console.log('[telegram] sin TELEGRAM_BOT_TOKEN/TELEGRAM_DEPLOY_CHAT_ID: aviso solo en el log');
    return false;
  }
  const cuerpo = texto.length > LIMITE ? `${texto.slice(0, LIMITE)}…` : texto;
  let r;
  try {
    r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: cuerpo, disable_web_page_preview: true }),
    });
  } catch (e) {
    // Error de red: solo el nombre (el mensaje podría llevar la URL con el token).
    console.log(`[telegram] no se pudo enviar: ${e?.name ?? 'error'}`);
    return false;
  }
  if (!r.ok) {
    // Sin el token en el mensaje de error.
    console.log(`[telegram] no se pudo enviar: HTTP ${r.status}`);
    return false;
  }
  return true;
}

if (process.argv[1]?.endsWith('telegram.mjs')) {
  let texto = process.argv.slice(2).join(' ');
  if (!texto) {
    const partes = [];
    for await (const p of process.stdin) partes.push(p);
    texto = Buffer.concat(partes).toString('utf8');
  }
  await avisar(texto.trim(), { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_DEPLOY_CHAT_ID });
}
