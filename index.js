const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require("@whiskeysockets/baileys")

const readline = require("readline")

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

// ======================
// STATE
// ======================
const menuState = {}
const userTracker = {}
const autoChats = {}

async function startBot() {

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
                console.log("\n📲 Pairing Code:", code)
                rl.close()
            } catch (err) {
                console.log("❌ Error:", err)
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

            if (shouldReconnect) startBot()
        }
    })

    // ======================
    // MESSAGE
    // ======================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const sender = msg.key.participant || msg.key.remoteJid

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ""

        if (!from.endsWith("@g.us")) return

        // ======================
        // INIT MENU STATE PER GROUP
        // ======================
        if (!menuState[from]) {
            menuState[from] = {
                active: false,
                admin: null
            }
        }

        const metadata = await sock.groupMetadata(from)
        const participants = metadata.participants

        const isAdmin = participants.some(p =>
            p.id === sender &&
            (p.admin === "admin" || p.admin === "superadmin")
        )

        // ======================
        // MENU (ADMIN ONLY)
        // ======================
        if (text === ".menu") {

            if (!isAdmin) return

            menuState[from] = {
                active: true,
                admin: sender
            }

            return sock.sendMessage(from, {
                text:
`📋 MENU BOT

1. info bot
2. aturan`
            })
        }

        // ======================
        // MENU RESPONSE (STRICT)
        // ======================
        if (menuState[from].active) {

            if (sender !== menuState[from].admin) return

            if (text === "1") {

                await sock.sendMessage(from, { text: "1. info bot" })
                delete menuState[from]
            }

            else if (text === "2") {

                await sock.sendMessage(from, { text: "2. aturan" })
                delete menuState[from]
            }

            else {
                return
            }
        }

        // ======================
        // 📋 ABSEN (ADMIN ONLY)
        // ======================
        if (text === ".absen") {

            try {

                if (!isAdmin) {
                    return sock.sendMessage(from, {
                        text: "❌ Hanya admin"
                    })
                }

                let mentions = []
                let list = "📋 ABSEN GROUP:\n\n"

                participants.forEach((p, i) => {

                    let id = p.id
                    let nomor = id.split("@")[0]

                    list += `${i + 1}. @${nomor}\n`
                    mentions.push(id)
                })

                await sock.sendMessage(from, {
                    text: list,
                    mentions
                })

            } catch (err) {}
        }

        // ======================
        // AUTO CHAT OWNER
        // ======================
        if (sender.startsWith("6281931965284")) {

            if (text.startsWith(".set ")) {

                const autoText = text.replace(".set ", "").trim()

                if (autoChats[autoText]) return

                const interval = setInterval(async () => {
                    await sock.sendMessage(from, { text: autoText })
                }, 24 * 60 * 60 * 1000)

                autoChats[autoText] = interval
            }

            if (text.startsWith(".no set ")) {

                const t = text.replace(".no set ", "").trim()

                clearInterval(autoChats[t])
                delete autoChats[t]
            }
        }

        // ======================
        // INIT USER
        // ======================
        if (!userTracker[sender]) {
            userTracker[sender] = {
                count: 0,
                violations: 0,
                lastSticker: 0,
                timer: null
            }
        }

        // ======================
        // ANTI STICKER
        // ======================
        const isSticker = !!msg.message.stickerMessage

        if (isSticker) {

            const now = Date.now()

            if (now - userTracker[sender].lastSticker > 30000) {
                userTracker[sender].count = 0
            }

            userTracker[sender].lastSticker = now
            userTracker[sender].count++

            if (userTracker[sender].count >= 5) {

                userTracker[sender].count = 0
                userTracker[sender].violations++
            }
        }

        // ======================
        // ANTI LINK
        // ======================
        const isLink =
            text.includes("http://") ||
            text.includes("https://") ||
            text.includes("www.")

        if (isLink) {

            userTracker[sender].violations++
        }

        // ======================
        // AUTO KICK
        // ======================
        if (userTracker[sender].violations >= 5) {

            try {
                await sock.groupParticipantsUpdate(from, [sender], "remove")
                delete userTracker[sender]
            } catch (err) {}
        }
    })
}

startBot()
