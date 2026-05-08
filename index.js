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

// ======================
// MONGODB CONFIG
// ======================
const MONGO_URI = "mongodb+srv://whastapp:whastapp@bot-wa.immkhj8.mongodb.net/whastapp?retryWrites=true&w=majority"

let db, users

async function initDB() {
    const client = new MongoClient(MONGO_URI)
    await client.connect()
    db = client.db("whastapp")
    users = db.collection("users")
    console.log("✅ MongoDB Connected")
}

// ======================
// STATE
// ======================
const menuState = {}

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

    // ======================
    // PAIRING CODE
    // ======================
    if (!sock.authState.creds.registered) {

        rl.question("Masukkan nomor (628xxx): ", async (nomor) => {

            try {
                const code = await sock.requestPairingCode(nomor.trim())
                console.log("📲 Pairing Code:", code)
            } catch (err) {
                console.log("❌ Gagal pairing:", err)
            }
        })
    }

    // ======================
    // CONNECTION
    // ======================
    sock.ev.on("connection.update", (update) => {

        const { connection, lastDisconnect } = update

        if (connection === "close") {

            const reason = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = reason !== DisconnectReason.loggedOut

            console.log("⚠️ Koneksi terputus:", reason)

            if (shouldReconnect) startBot()
            else console.log("❌ Logout, hapus session")
        }

        if (connection === "open") {
            console.log("✅ Bot aktif")
        }
    })

    // ======================
    // USER DB INIT
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
    // MESSAGE HANDLER
    // ======================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const sender = msg.key.participant || msg.key.remoteJid

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.buttonsResponseMessage?.selectedButtonId ||
            ""

        if (!from.endsWith("@g.us")) return

        const metadata = await sock.groupMetadata(from)
        const participants = metadata.participants

        const isAdmin = participants.some(p =>
            p.id === sender &&
            (p.admin === "admin" || p.admin === "superadmin")
        )

        let user = await getUser(sender)

        // ======================
        // MENU (1 / 2 TANPA BUTTON)
        // ======================
        if (text === ".menu") {

            if (!isAdmin) return

            menuState[from] = sender

            await sock.sendMessage(from, {
                text:
`📋 MENU BOT

1. INFO BOT
2. ATURAN`
            })

            return
        }

        if (menuState[from] === sender) {

            if (text === "1") {

                await sock.sendMessage(from, {
                    text:
`🤖 INFO BOT

• Bot anti link
• Bot anti spam sticker
• Auto kick system`
                })
            }

            if (text === "2") {

                await sock.sendMessage(from, {
                    text:
`📜 ATURAN GROUP

• Jangan spam sticker
• Jangan kirim link
• Hormati member`
                })
            }

            delete menuState[from]
        }

        // ======================
        // ABSEN
        // ======================
        if (text === ".absen") {

            if (!isAdmin) return

            let list = "📋 ABSEN GROUP:\n\n"
            let mentions = []

            participants.forEach((p, i) => {
                list += `${i + 1}. @${p.id.split("@")[0]}\n`
                mentions.push(p.id)
            })

            await sock.sendMessage(from, {
                text: list,
                mentions
            })
        }

        // ======================
        // DETECT
        // ======================
        const isSticker = !!msg.message.stickerMessage

        const safeText = text.toLowerCase()
        const isLink =
            safeText.includes("http") ||
            safeText.includes("www")

        // ======================
        // ANTI STICKER
        // ======================
        if (isSticker) {

            const now = Date.now()

            if (now - user.lastSticker > 30000) {
                user.count = 0
            }

            user.lastSticker = now
            user.count++

            if (user.count >= 5) {

                user.count = 0
                user.violations++

                let namaUser = sender.split("@")[0]

                await sock.sendMessage(from, {
                    text:
`woy @${namaUser} asu, please stop spam sticker 5× berturut2 ya anak anj, sekarang pelanggaran kamu: (${user.violations})`,
                    mentions: [sender]
                })
            }

            await saveUser(sender, user)
        }

        // ======================
        // ANTI LINK
        // ======================
        if (isLink) {

            await sock.sendMessage(from, {
                delete: msg.key
            })

            user.violations++

            let namaUser = sender.split("@")[0]

            await sock.sendMessage(from, {
                text:
`woy @${namaUser} asu, stop kirim link ya anak anj, pelanggaran kamu sekarang: (${user.violations})`,
                mentions: [sender]
            })

            await saveUser(sender, user)
        }

        // ======================
        // AUTO KICK
        // ======================
        if (user.violations >= 5) {

            let namaUser = sender.split("@")[0]

            await sock.sendMessage(from, {
                text:
`@${namaUser} bye 😹`,
                mentions: [sender]
            })

            try {
                await sock.groupParticipantsUpdate(from, [sender], "remove")
                await users.deleteOne({ id: sender })
            } catch (err) {
                console.log("❌ gagal kick:", err)
            }
        }

    })
}

startBot()
