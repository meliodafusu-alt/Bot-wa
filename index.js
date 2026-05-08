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
                console.log("Masukkan ke WhatsApp > Perangkat Tertaut\n")

                rl.close()

            } catch (err) {
                console.log("❌ Gagal ambil pairing code:", err)
            }
        })
    }

    // ======================
    // RECONNECT
    // ======================
    sock.ev.on("connection.update", (update) => {

        const { connection, lastDisconnect } = update

        if (connection === "close") {

            const reason = lastDisconnect?.error?.output?.statusCode
            const shouldReconnect = reason !== DisconnectReason.loggedOut

            console.log("⚠️ Koneksi terputus:", reason)
            console.log("🔄 Reconnect:", shouldReconnect)

            if (shouldReconnect) startBot()
            else console.log("❌ Logout! Hapus session lalu login ulang")
        }

        if (connection === "open") {
            console.log("✅ Bot berhasil terhubung ke WhatsApp!")
        }
    })

    // ======================
    // WELCOME / LEFT
    // ======================
    sock.ev.on("group-participants.update", async (update) => {

        try {

            const metadata = await sock.groupMetadata(update.id)
            const groupName = metadata.subject

            for (let user of update.participants) {

                let idUser = typeof user === "string" ? user : user.id
                let namaUser = idUser.split("@")[0]

                if (update.action === "add") {
                    await sock.sendMessage(update.id, {
                        text: `👋 Welcome @${namaUser} to my group *${groupName}*`,
                        mentions: [idUser]
                    })
                }

                if (update.action === "remove") {
                    await sock.sendMessage(update.id, {
                        text: `Sayonara @${namaUser}👋`,
                        mentions: [idUser]
                    })
                }
            }

        } catch (err) {
            console.log("❌ Error group event:", err)
        }
    })

    // ======================
    // RESET PELANGGARAN
    // ======================
    function setResetTimer(sender, from) {

        if (userTracker[sender]?.timer) {
            clearTimeout(userTracker[sender].timer)
        }

        userTracker[sender].timer = setTimeout(async () => {

            if (userTracker[sender]?.violations > 0 &&
                userTracker[sender].violations < 5) {

                let namaUser = sender.split("@")[0]

                userTracker[sender] = {
                    count: 0,
                    violations: 0,
                    timer: null,
                    lastSticker: 0
                }

                await sock.sendMessage(from, {
                    text: `woy @${namaUser} anak asu, pelanggaran kamu direset`,
                    mentions: [sender]
                })
            }

        }, 2 * 60 * 60 * 1000)
    }

    // ======================
    // MESSAGE HANDLER
    // ======================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        try {

            const msg = messages[0]
            if (!msg.message) return

            const from = msg.key.remoteJid
            const sender = msg.key.participant || msg.key.remoteJid

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                ""

            if (!from.endsWith("@g.us")) return

            const isSticker = !!msg.message.stickerMessage

            const isLink =
                text.includes("http://") ||
                text.includes("https://") ||
                text.includes("www.")

            // ======================
            // MENU BOT
            // ======================
            if (text === ".menu") {

                await sock.sendMessage(from, {
                    text:
`📋 MENU BOT

1. info bot
2. aturan

Ketik 1 atau 2`
                })

                menuState[from] = true
            }

            if (menuState[from]) {

                if (text === "1") {
                    await sock.sendMessage(from, { text: "1." })
                    delete menuState[from]
                }

                if (text === "2") {
                    await sock.sendMessage(from, { text: "2." })
                    delete menuState[from]
                }
            }

            // ======================
            // 📋 ABSEN (ADMIN ONLY + TAG ALL)
            // ======================
            if (text === ".absen") {

                try {

                    const metadata = await sock.groupMetadata(from)
                    const participants = metadata.participants

                    const isAdmin = participants.some(p =>
                        p.id === sender &&
                        (p.admin === "admin" || p.admin === "superadmin")
                    )

                    if (!isAdmin) {
                        return sock.sendMessage(from, {
                            text: "❌ Perintah ini hanya untuk admin"
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

                } catch (err) {
                    console.log("❌ Error absen:", err)
                }
            }

            // ======================
            // AUTO CHAT OWNER
            // ======================
            if (sender.startsWith("6281931965284")) {

                if (text.startsWith(".set ")) {

                    const autoText = text.replace(".set ", "").trim()

                    if (autoChats[autoText]) {
                        return sock.sendMessage(from, {
                            text: `"${autoText}" sudah aktif`
                        })
                    }

                    await sock.sendMessage(from, { text: "siap!" })

                    const interval = setInterval(async () => {

                        await sock.sendMessage(from, {
                            text: autoText
                        })

                    }, 24 * 60 * 60 * 1000)

                    autoChats[autoText] = interval
                }

                if (text.startsWith(".no set ")) {

                    const removeText = text.replace(".no set ", "").trim()

                    if (!autoChats[removeText]) {
                        return sock.sendMessage(from, {
                            text: `"${removeText}" tidak ditemukan`
                        })
                    }

                    clearInterval(autoChats[removeText])
                    delete autoChats[removeText]

                    await sock.sendMessage(from, {
                        text: `"${removeText}" berhasil dimatikan`
                    })
                }
            }

            // ======================
            // INIT USER
            // ======================
            if (!userTracker[sender]) {
                userTracker[sender] = {
                    count: 0,
                    violations: 0,
                    timer: null,
                    lastSticker: 0
                }
            }

            // ======================
            // ANTI STICKER
            // ======================
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

                    let namaUser = sender.split("@")[0]

                    await sock.sendMessage(from, {
                        text: `woy @${namaUser} asu, stop spam sticker`,
                        mentions: [sender]
                    })

                    setResetTimer(sender, from)
                }

            } else {
                userTracker[sender].count = 0
            }

            // ======================
            // ANTI LINK
            // ======================
            if (isLink) {

                await sock.sendMessage(from, {
                    delete: msg.key
                })

                userTracker[sender].violations++

                let namaUser = sender.split("@")[0]

                await sock.sendMessage(from, {
                    text: `woy @${namaUser} asu, stop kirim link`,
                    mentions: [sender]
                })

                setResetTimer(sender, from)
            }

            // ======================
            // AUTO KICK
            // ======================
            if (userTracker[sender].violations >= 5) {

                let namaUser = sender.split("@")[0]

                await sock.sendMessage(from, {
                    text: `@${namaUser} bye 😹`,
                    mentions: [sender]
                })

                try {
                    await sock.groupParticipantsUpdate(from, [sender], "remove")
                    delete userTracker[sender]
                } catch (err) {
                    setResetTimer(sender, from)
                }
            }

        } catch (err) {
            console.log("❌ Error:", err)
        }
    })
}

startBot()
