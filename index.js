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
                        text:
`👋 Welcome @${namaUser} to my group *${groupName}*`,
                        mentions: [idUser]
                    })
                }

                if (update.action === "remove") {

                    await sock.sendMessage(update.id, {
                        text:
`Sayonara @${namaUser}👋`,
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

            if (
                userTracker[sender]?.violations > 0 &&
                userTracker[sender].violations < 5
            ) {

                let namaUser = sender.split("@")[0]

                userTracker[sender] = {
                    count: 0,
                    violations: 0,
                    timer: null,
                    lastSticker: 0
                }

                await sock.sendMessage(from, {
                    text:
`woy @${namaUser} anak asu, sekarang pelanggaran kau udh gw hapus, lain kali jangan melanggar lagi ya anak anj`,
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
                msg.message.buttonsResponseMessage?.selectedButtonId ||
                ""

            if (!from.endsWith("@g.us")) return

            // ======================
            // GROUP DATA
            // ======================
            const metadata = await sock.groupMetadata(from)
            const participants = metadata.participants

            const isAdmin = participants.some(p =>
                p.id === sender &&
                (p.admin === "admin" || p.admin === "superadmin")
            )

            // ======================
            // INIT MENU STATE
            // ======================
            if (!menuState[from]) {

                menuState[from] = {
                    active: false,
                    admin: null
                }
            }

            // ======================
            // MENU BOT
            // ======================
            if (text === ".menu") {

                if (!isAdmin) return

                menuState[from] = {
                    active: true,
                    admin: sender
                }

                await sock.sendMessage(from, {
                    text: "📋 MENU BOT",
                    footer: "pilih menu anak asu 😹",
                    buttons: [
                        {
                            buttonId: "1",
                            buttonText: {
                                displayText: "INFO BOT"
                            },
                            type: 1
                        },
                        {
                            buttonId: "2",
                            buttonText: {
                                displayText: "ATURAN"
                            },
                            type: 1
                        }
                    ],
                    headerType: 1
                })

                return
            }

            // ======================
            // MENU RESPONSE
            // ======================
            if (menuState[from].active) {

                if (sender !== menuState[from].admin) return

                if (text === "1") {

                    await sock.sendMessage(from, {
                        text:
`🤖 INFO BOT

• Bot anti link
• Bot anti spam sticker
• Auto kick member bangsat 😹`
                    })

                    delete menuState[from]
                    return
                }

                if (text === "2") {

                    await sock.sendMessage(from, {
                        text:
`📜 ATURAN GROUP

• Jangan spam sticker anak anj
• Jangan kirim link asu
• Hormati member lain 😹`
                    })

                    delete menuState[from]
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
                            text:
"❌ Perintah ini hanya untuk admin"
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

                return
            }

            // ======================
            // AUTO CHAT OWNER
            // ======================
            if (sender.startsWith("6281931965284")) {

                if (text.startsWith(".set ")) {

                    const autoText =
                        text.replace(".set ", "").trim()

                    if (autoChats[autoText]) {

                        return sock.sendMessage(from, {
                            text:
`"${autoText}" sudah aktif`
                        })
                    }

                    await sock.sendMessage(from, {
                        text: "siap anak asu 😹"
                    })

                    const interval = setInterval(async () => {

                        await sock.sendMessage(from, {
                            text: autoText
                        })

                    }, 24 * 60 * 60 * 1000)

                    autoChats[autoText] = interval
                }

                if (text.startsWith(".no set ")) {

                    const removeText =
                        text.replace(".no set ", "").trim()

                    if (!autoChats[removeText]) {

                        return sock.sendMessage(from, {
                            text:
`"${removeText}" tidak ditemukan`
                        })
                    }

                    clearInterval(autoChats[removeText])
                    delete autoChats[removeText]

                    await sock.sendMessage(from, {
                        text:
`"${removeText}" berhasil dimatikan`
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
            // DETECT
            // ======================
            const isSticker =
                !!msg.message.stickerMessage

            const isLink =
                text.includes("http://") ||
                text.includes("https://") ||
                text.includes("www.")

            // ======================
            // ANTI STICKER
            // ======================
            if (isSticker) {

                const now = Date.now()

                if (
                    now -
                    userTracker[sender].lastSticker >
                    30000
                ) {

                    userTracker[sender].count = 0
                }

                userTracker[sender].lastSticker = now
                userTracker[sender].count++

                if (userTracker[sender].count >= 5) {

                    userTracker[sender].count = 0
                    userTracker[sender].violations++

                    let namaUser =
                        sender.split("@")[0]

                    let jumlah =
                        userTracker[sender].violations

                    await sock.sendMessage(from, {
                        text:
`woy @${namaUser} asu, please stop spam sticker 5× berturut2 ya anak anj, sekarang pelanggaran kamu: (${jumlah})`,
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

                let namaUser =
                    sender.split("@")[0]

                let jumlah =
                    userTracker[sender].violations

                await sock.sendMessage(from, {
                    text:
`woy @${namaUser} asu, stop kirim link ya anak anj, pelanggaran kamu sekarang: (${jumlah})`,
                    mentions: [sender]
                })

                setResetTimer(sender, from)
            }

            // ======================
            // AUTO KICK
            // ======================
            if (
                userTracker[sender].violations >= 5
            ) {

                let namaUser =
                    sender.split("@")[0]

                await sock.sendMessage(from, {
                    text:
`@${namaUser} bye anak asu 😹😹😹`,
                    mentions: [sender]
                })

                try {

                    await sock.groupParticipantsUpdate(
                        from,
                        [sender],
                        "remove"
                    )

                    delete userTracker[sender]

                } catch (err) {

                    console.log(
                        "❌ Bot bukan admin / gagal kick:",
                        err
                    )

                    setResetTimer(sender, from)
                }
            }

        } catch (err) {

            console.log("❌ Error:", err)
        }
    })
}

startBot()
