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
    return new Promise(resolve =>
        rl.question(text, resolve)
    )
}

// ======================
// DATABASE
// ======================
const MONGO_URI =
"mongodb+srv://whastapp:whastapp@bot-wa.immkhj8.mongodb.net/whastapp?retryWrites=true&w=majority"

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
const userTimers = {}

// ======================
// LOCK GROUP
// ======================
const LOCK_GROUP =
"120363410026332799@g.us"

// ======================
// USER DB
// ======================
async function getUser(id) {

    let data =
        await users.findOne({ id })

    if (!data) {

        data = {
            id,
            count: 0,
            violations: 0,
            lastSticker: 0
        }

        await users.insertOne(data)
    }

    return data
}

async function saveUser(id, data) {

    await users.updateOne(
        { id },
        { $set: data }
    )
}

// ======================
// RESET PELANGGARAN
// ======================
function setResetTimer(
    sock,
    sender,
    from
) {

    if (userTimers[sender]) {
        clearTimeout(userTimers[sender])
    }

    userTimers[sender] =
        setTimeout(async () => {

        let user =
            await users.findOne({
                id: sender
            })

        if (
            user &&
            user.violations > 0 &&
            user.violations < 5
        ) {

            let name =
                sender.split("@")[0]

            await users.updateOne(
                { id: sender },
                {
                    $set: {
                        count: 0,
                        violations: 0,
                        lastSticker: 0
                    }
                }
            )

            console.log(
                "♻️ RESET:",
                name
            )

            await sock.sendMessage(from, {
                text: `@${name}`,
                mentions: [sender]
            })
        }

    }, 4 * 60 * 60 * 1000)
}

// ======================
// GROUP EVENT
// ======================
function registerGroupHandler(sock) {

    sock.ev.removeAllListeners(
        "group-participants.update"
    )

    sock.ev.on(
        "group-participants.update",
        async (u) => {

        try {

            console.log(
                "👥 GROUP EVENT:",
                u.action
            )

            const meta =
                await sock.groupMetadata(u.id)

            const groupName =
                meta.subject

            for (let p of u.participants) {

                const id =
                    typeof p === "string"
                        ? p
                        : p.id

                const name =
                    id.split("@")[0]

                // ======================
                // WELCOME
                // ======================
                if (
                    u.action === "add" ||
                    u.action === "invite" ||
                    u.action === "join"
                ) {

                    console.log(
                        "✅ MEMBER JOIN:",
                        name
                    )

                    await sock.sendMessage(u.id, {
                        text:
`👋 Welcome @${name} to my group *${groupName}*`,
                        mentions: [id]
                    })
                }

                // ======================
                // REMOVE
                // ======================
                if (
                    u.action === "remove"
                ) {

                    console.log(
                        "❌ MEMBER REMOVE:",
                        name
                    )

                    // ======================
                    // GROUP LOCK
                    // ======================
                    if (
                        u.id === LOCK_GROUP
                    ) {

                        await sock.sendMessage(u.id, {
                            text:
`@${name} tidak boleh keluar 😹`,
                            mentions: [id]
                        })

                        try {

                            console.log(
                                "🔄 ADD ULANG:",
                                name
                            )

                            await sock.groupParticipantsUpdate(
                                u.id,
                                [id],
                                "add"
                            )

                            await sock.sendMessage(u.id, {
                                text:
`👋 Welcome back @${name}`,
                                mentions: [id]
                            })

                        } catch (e) {

                            console.log(
                                "❌ gagal add lagi:",
                                e
                            )

                            await sock.sendMessage(u.id, {
                                text:
`❌ Gagal menambahkan kembali @${name}`,
                                mentions: [id]
                            })
                        }

                    } else {

                        await sock.sendMessage(u.id, {
                            text:
`Sayonara @${name}👋`,
                            mentions: [id]
                        })
                    }
                }
            }

        } catch (e) {

            console.log(
                "❌ group error:",
                e
            )
        }
    })
}

// ======================
// BOT START
// ======================
async function startBot() {

    await initDB()

    const {
        state,
        saveCreds
    } =
        await useMultiFileAuthState(
            "session"
        )

    const { version } =
        await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false
    })

    // ======================
    // PAIRING CODE
    // ======================
    if (!sock.authState.creds.registered) {

        const nomor =
            await question(
                "Masukkan nomor WhatsApp:\n"
            )

        const code =
            await sock.requestPairingCode(
                nomor
            )

        console.log(
            "📱 PAIRING CODE:",
            code
        )
    }

    sock.ev.on(
        "creds.update",
        saveCreds
    )

    registerGroupHandler(sock)

    // ======================
    // CONNECTION
    // ======================
    sock.ev.on(
        "connection.update",
        (u) => {

        const {
            connection,
            lastDisconnect
        } = u

        console.log(
            "📡 CONNECTION:",
            connection
        )

        if (
            connection === "open"
        ) {

            console.log(
                "✅ BOT ONLINE"
            )
        }

        if (
            connection === "close"
        ) {

            const reason =
                lastDisconnect?.error
                ?.output?.statusCode

            console.log(
                "❌ CONNECTION CLOSED:",
                reason
            )

            if (
                reason !==
                DisconnectReason.loggedOut
            ) {

                console.log(
                    "🔄 RECONNECT..."
                )

                startBot()
            }
        }
    })

    // ======================
    // MESSAGE
    // ======================
    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

        try {

            console.log(
                "📩 MESSAGE MASUK"
            )

            const msg = messages[0]

            if (!msg?.message) {

                console.log(
                    "❌ MESSAGE KOSONG"
                )

                return
            }

            const from =
                msg.key.remoteJid

            const sender =
                msg.key.participant ||
                msg.key.remoteJid

            console.log(
                "👤 SENDER:",
                sender
            )

            console.log(
                "👥 GROUP:",
                from
            )

            const m =
                msg.message

            const text =
                m?.conversation ||
                m?.extendedTextMessage?.text ||
                m?.imageMessage?.caption ||
                m?.videoMessage?.caption ||
                m?.buttonsResponseMessage?.selectedButtonId ||
                m?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                ""

            console.log(
                "➡️ TEXT:",
                text
            )

            const clean =
                (text || "")
                    .toLowerCase()
                    .trim()

            if (
                !from.endsWith("@g.us")
            ) {

                console.log(
                    "❌ BUKAN GROUP"
                )

                return
            }

            const metadata =
                await sock.groupMetadata(from)

            const participants =
                metadata.participants

            const isAdmin =
                participants.some(p =>
                    p.id === sender &&
                    (
                        p.admin === "admin" ||
                        p.admin === "superadmin"
                    )
                )

            let user =
                await getUser(sender)

            // ======================
            // MENU
            // ======================
            if (
                clean === ".menu"
            ) {

                console.log(
                    "📋 MENU DIPAKAI"
                )

                if (!isAdmin) return

                menuState[from] =
                    sender

                await sock.sendMessage(from, {
                    text:
`📋 MENU BOT

1. INFO BOT
2. ATURAN`
                })

                return
            }

            if (
                menuState[from] === sender
            ) {

                if (clean === "1") {

                    await sock.sendMessage(from, {
                        text:
`🤖 INFO BOT

• Anti link
• Anti spam sticker
• Auto kick`
                    })
                }

                if (clean === "2") {

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
            if (
                clean === ".absen"
            ) {

                console.log(
                    "📋 ABSEN DIPAKAI"
                )

                let list =
`📋 SEMUA ANGGOTA:

`

                let mentions = []

                participants.forEach(
                    (p, i) => {

                    list +=
`${i + 1}. @${p.id.split("@")[0]}
`

                    mentions.push(p.id)
                })

                await sock.sendMessage(from, {
                    text: list,
                    mentions
                })

                return
            }

            // ======================
            // ANTI LINK
            // ======================
            const isLink =
                /https?:\/\/|www\./i
                    .test(clean)

            if (isLink) {

                console.log(
                    "🚫 LINK TERDETEKSI"
                )

                await sock.sendMessage(from, {
                    delete: msg.key
                })

                user.violations++

                let name =
                    sender.split("@")[0]

                await sock.sendMessage(from, {
                    text:
`woy @${name} asu, stop kirim link ya anak anj, pelanggaran kamu sekarang: (${user.violations})`,
                    mentions: [sender]
                })

                setResetTimer(
                    sock,
                    sender,
                    from
                )
            }

            // ======================
            // ANTI STICKER
            // ======================
            const isSticker =
                !!m?.stickerMessage

            if (isSticker) {

                console.log(
                    "🖼️ STICKER TERDETEKSI"
                )

                const now =
                    Date.now()

                if (
                    now - user.lastSticker >
                    30000
                ) {
                    user.count = 0
                }

                user.lastSticker =
                    now

                user.count++

                console.log(
                    "📊 STICKER COUNT:",
                    user.count
                )

                if (
                    user.count >= 5
                ) {

                    user.violations++

                    let name =
                        sender.split("@")[0]

                    await sock.sendMessage(from, {
                        text:
`woy @${name} asu, please stop spam sticker 5× berturut2 ya anak anj, sekarang pelanggaran kamu: (${user.violations})`,
                        mentions: [sender]
                    })

                    user.count = 0

                    setResetTimer(
                        sock,
                        sender,
                        from
                    )
                }
            }

            await saveUser(
                sender,
                user
            )

            // ======================
            // AUTO KICK
            // ======================
            if (
                user.violations >= 5
            ) {

                console.log(
                    "👢 AUTO KICK:",
                    sender
                )

                let name =
                    sender.split("@")[0]

                await sock.sendMessage(from, {
                    text:
`@${name} bye anak asu 😹`,
                    mentions: [sender]
                })

                try {

                    await sock.groupParticipantsUpdate(
                        from,
                        [sender],
                        "remove"
                    )

                    await users.deleteOne({
                        id: sender
                    })

                } catch (e) {

                    console.log(
                        "❌ kick error:",
                        e
                    )
                }
            }

        } catch (err) {

            console.log(
                "❌ ERROR:",
                err
            )
        }
    })
}

startBot()
