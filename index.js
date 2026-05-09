const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("baileys")

const { MongoClient } = require("mongodb")
const readline = require("readline")

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

async function question(text) {
    return new Promise(resolve => rl.question(text, resolve))
}

// ======================
// DATABASE
// ======================
const MONGO_URI = "mongodb+srv://whastapp:whastapp@bot-wa.immkhj8.mongodb.net/whastapp?retryWrites=true&w=majority"

let db, users, settings

async function initDB() {
    const client = new MongoClient(MONGO_URI)
    await client.connect()

    db = client.db("whastapp")
    users = db.collection("users")
    settings = db.collection("settings")

    console.log("✅ MongoDB Connected")
}

// ======================
// OWNER
// ======================
const OWNER = "6281931965284@s.whatsapp.net"

// ======================
// STATE
// ======================
const menuState = {}
const panelState = {}
const userTimers = {}

// ======================
// USER SYSTEM
// ======================
async function getUser(id) {
    let data = await users.findOne({ id })

    if (!data) {
        data = { id, count: 0, violations: 0, lastSticker: 0 }
        await users.insertOne(data)
    }

    return data
}

async function saveUser(id, data) {
    await users.updateOne({ id }, { $set: data })
}

// ======================
// RESET TIMER
// ======================
function setResetTimer(sock, sender, from) {

    if (userTimers[sender]) clearTimeout(userTimers[sender])

    userTimers[sender] = setTimeout(async () => {

        let user = await users.findOne({ id: sender })

        if (user && user.violations > 0 && user.violations < 5) {

            let name = sender.split("@")[0]

            await users.updateOne(
                { id: sender },
                { $set: { count: 0, violations: 0, lastSticker: 0 } }
            )

            await sock.sendMessage(from, {
                text: `@${name}`,
                mentions: [sender]
            })
        }

    }, 4 * 60 * 60 * 1000)
}

// ======================
// SETTINGS (WELCOME / LEAVE)
// ======================
async function getSetting(id) {
    let data = await settings.findOne({ id })

    if (!data) {
        data = { id, welcome: "", leave: "" }
        await settings.insertOne(data)
    }

    return data
}

// ======================
// GROUP HANDLER
// ======================
function registerGroupHandler(sock) {

sock.ev.on("group-participants.update", async (u) => {

try {

    const meta = await sock.groupMetadata(u.id)
    const groupName = meta.subject
    const set = await getSetting(u.id)

    for (let p of u.participants) {

        const id = typeof p === "string" ? p : p.id
        const name = id.split("@")[0]

        // WELCOME
        if (u.action === "add") {

            let text = set.welcome || `👋 Welcome @${name} to my group *${groupName}*`

            text = text
                .replace(/\$@\(user\)/gi, `@${name}`)
                .replace(/\(nama group\)/gi, groupName)

            await sock.sendMessage(u.id, {
                text,
                mentions: [id]
            })
        }

        // LEAVE
        if (u.action === "remove") {

            let text = set.leave || `Sayonara @${name}👋`

            text = text
                .replace(/\$@\(user\)/gi, `@${name}`)
                .replace(/\(nama group\)/gi, groupName)

            await sock.sendMessage(u.id, {
                text,
                mentions: [id]
            })
        }
    }

} catch (e) {
    console.log("❌ group error:", e)
}

})
}

// ======================
// BOT START
// ======================
async function startBot() {

await initDB()

const { state, saveCreds } =
    await useMultiFileAuthState("session")

const { version } =
    await fetchLatestBaileysVersion()

const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
})

sock.ev.on("creds.update", saveCreds)

registerGroupHandler(sock)

// ======================
// AUTO RECONNECT STABLE
// ======================
sock.ev.on("connection.update", (update) => {

    const { connection, lastDisconnect } = update

    if (connection === "close") {

        const reason = lastDisconnect?.error?.output?.statusCode

        if (reason !== DisconnectReason.loggedOut) {
            setTimeout(() => startBot(), 3000)
        }
    }

})

// ======================
// MESSAGE HANDLER
// ======================
sock.ev.on("messages.upsert", async ({ messages }) => {

const msg = messages[0]
if (!msg?.message) return

const from = msg.key.remoteJid
const sender = msg.key.participant || from

const text =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    ""

const clean = text.toLowerCase().trim()

// PANEL WELCOME
if (clean === ".setwelcome" && sender === OWNER) {
    panelState[from] = "welcome"
    return sock.sendMessage(from, { text: "Kirim template welcome sekarang" })
}

if (panelState[from] === "welcome" && sender === OWNER) {

    await settings.updateOne(
        { id: from },
        { $set: { welcome: text } },
        { upsert: true }
    )

    delete panelState[from]

    return sock.sendMessage(from, { text: "✅ Welcome berhasil disimpan" })
}

// PANEL LEAVE
if (clean === ".setleave" && sender === OWNER) {
    panelState[from] = "leave"
    return sock.sendMessage(from, { text: "Kirim template leave sekarang" })
}

if (panelState[from] === "leave" && sender === OWNER) {

    await settings.updateOne(
        { id: from },
        { $set: { leave: text } },
        { upsert: true }
    )

    delete panelState[from]

    return sock.sendMessage(from, { text: "✅ Leave berhasil disimpan" })
}

// MENU ADMIN
if (clean === ".menu") {

    const meta = await sock.groupMetadata(from)

    const isAdmin = meta.participants.some(p =>
        p.id === sender &&
        (p.admin === "admin" || p.admin === "superadmin")
    )

    if (!isAdmin && sender !== OWNER) return

    menuState[from] = sender

    return sock.sendMessage(from, {
        text: "1.all fitur\n2.aturan"
    })
}

if (menuState[from] === sender) {

    if (clean === "1") {
        sock.sendMessage(from, {
            text: `📌 FITUR BOT:

- Anti Link
- Anti Spam Sticker
- Auto Kick
- Welcome MongoDB
- Leave MongoDB
- Panel Owner
- Absen`
        })
    }

    if (clean === "2") {
        sock.sendMessage(from, { text: "aturan group" })
    }

    delete menuState[from]
}

// ABSEN
if (clean === ".absen") {

    let meta = await sock.groupMetadata(from)
    let participants = meta.participants

    let list = "📋 SEMUA ANGGOTA:\n\n"
    let mentions = []

    participants.forEach((p, i) => {
        list += `${i + 1}. @${p.id.split("@")[0]}\n`
        mentions.push(p.id)
    })

    return sock.sendMessage(from, { text: list, mentions })
}

// ANTI LINK
const isLink = /https?:\/\/|www\./i.test(clean)

if (isLink) {

    await sock.sendMessage(from, { delete: msg.key })

    let user = await getUser(sender)
    user.violations++

    await saveUser(sender, user)

    let name = sender.split("@")[0]

    await sock.sendMessage(from, {
        text: `woy @${name} asu, stop kirim link ya anak anj, pelanggaran kamu sekarang: (${user.violations})`,
        mentions: [sender]
    })

    setResetTimer(sock, sender, from)
}

// ANTI STICKER
const isSticker = !!msg.message?.stickerMessage

if (isSticker) {

    let user = await getUser(sender)

    const now = Date.now()

    if (now - user.lastSticker > 30000) user.count = 0

    user.lastSticker = now
    user.count++

    if (user.count >= 5) {

        user.violations++

        await saveUser(sender, user)

        let name = sender.split("@")[0]

        await sock.sendMessage(from, {
            text: `woy @${name} asu, please stop spam sticker 5× berturut2 ya anak anj, sekarang pelanggaran kamu: (${user.violations})`,
            mentions: [sender]
        })

        user.count = 0
        setResetTimer(sock, sender, from)
    }

    await saveUser(sender, user)
}

})

}

startBot()
