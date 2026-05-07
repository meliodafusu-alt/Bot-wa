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

    // 🔑 PAIRING CODE
    if (!sock.authState.creds.registered) {

        rl.question(
            "Masukkan nomor (628xxx): ",
            async (nomor) => {

                try {

                    const code =
                        await sock.requestPairingCode(
                            nomor.trim()
                        )

                    console.log(
                        "\n📲 Pairing Code:",
                        code
                    )

                    console.log(
                        "Masukkan ke WhatsApp > Perangkat Tertaut\n"
                    )

                    rl.close()

                } catch (err) {

                    console.log(
                        "❌ Gagal ambil pairing code:",
                        err
                    )

                }
            }
        )
    }

    // 🔄 AUTO RECONNECT
    sock.ev.on("connection.update", (update) => {

        const {
            connection,
            lastDisconnect
        } = update

        if (connection === "close") {

            const reason =
                lastDisconnect?.error?.output?.statusCode

            const shouldReconnect =
                reason !== DisconnectReason.loggedOut

            console.log(
                "⚠️ Koneksi terputus:",
                reason
            )

            console.log(
                "🔄 Reconnect:",
                shouldReconnect
            )

            if (shouldReconnect) {
                startBot()
            } else {
                console.log(
                    "❌ Logout! Hapus session lalu login ulang"
                )
            }
        }

        if (connection === "open") {

            console.log(
                "✅ Bot berhasil terhubung ke WhatsApp!"
            )
        }
    })

    // 👋 WELCOME + SAYONARA
    sock.ev.on(
        "group-participants.update",
        async (update) => {

            try {

                const metadata =
                    await sock.groupMetadata(update.id)

                const groupName =
                    metadata.subject

                for (let user of update.participants) {

                    let idUser =
                        typeof user === "string"
                            ? user
                            : user.id

                    let namaUser =
                        idUser.split("@")[0]

                    // 👋 WELCOME
                    if (update.action === "add") {

                        await sock.sendMessage(
                            update.id,
                            {
                                text:
`👋 Welcome @${namaUser} to my group *${groupName}*`,
                                mentions: [idUser]
                            }
                        )
                    }

                    // 🚪 SAYONARA
                    if (update.action === "remove") {

                        await sock.sendMessage(
                            update.id,
                            {
                                text:
`Sayonara @${namaUser}👋`,
                                mentions: [idUser]
                            }
                        )
                    }
                }

            } catch (err) {

                console.log(
                    "❌ Error group event:",
                    err
                )

            }
        }
    )

    // =====================================
    // 🚫 ANTI SPAM + ANTI LINK
    // =====================================

    const userTracker = {}

    // ⏱ RESET PELANGGARAN 2 JAM
    function setResetTimer(sender, from) {

        if (userTracker[sender]?.timer) {
            clearTimeout(
                userTracker[sender].timer
            )
        }

        userTracker[sender].timer =
            setTimeout(async () => {

                if (
                    userTracker[sender] &&
                    userTracker[sender].violations > 0 &&
                    userTracker[sender].violations < 5
                ) {

                    let namaUser =
                        sender.split("@")[0]

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

    // =====================================
    // 🤖 AUTO CHAT SYSTEM
    // =====================================

    const ownerNumber =
        "6281931965284@s.whatsapp.net"

    const autoChats = {}

    // =====================================
    // 📩 DETEKSI PESAN
    // =====================================

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            try {

                const msg = messages[0]

                if (!msg.message) return

                const from =
                    msg.key.remoteJid

                const sender =
                    msg.key.participant ||
                    msg.key.remoteJid

                const text =
                    msg.message.conversation ||
                    msg.message.extendedTextMessage?.text ||
                    ""

                // hanya grup
                if (!from.endsWith("@g.us"))
                    return

                const isSticker =
                    !!msg.message.stickerMessage

                const isLink =
    text.includes("http://") ||
    text.includes("https://") ||
    text.includes("www.")

                // ======================
                // 🤖 AUTO CHAT COMMAND
                // ======================

                if (sender.startsWith("6281931965284")) {

                    // 📌 .SET
                    if (text.startsWith(".set ")) {

                        const autoText =
                            text.replace(".set ", "").trim()

                        if (!autoText) return

                        // sudah aktif
                        if (autoChats[autoText]) {

                            await sock.sendMessage(from, {
                                text:
`"${autoText}" sudah aktif`
                            })

                            return
                        }

                        await sock.sendMessage(from, {
                            text: "siap!"
                        })

                        // interval 24 jam
                        const interval =
                            setInterval(async () => {

                                try {

                                    await sock.sendMessage(
                                        from,
                                        {
                                            text: autoText
                                        }
                                    )

                                } catch (err) {

                                    console.log(
                                        "❌ Error auto chat:",
                                        err
                                    )

                                }

                            },
                            24 * 60 * 60 * 1000)

                        autoChats[autoText] =
                            interval
                    }

                    // ❌ .NO SET
                    if (
                        text.startsWith(
                            ".no set "
                        )
                    ) {

                        const removeText =
                            text.replace(
                                ".no set ",
                                ""
                            ).trim()

                        // tidak ada
                        if (
                            !autoChats[
                                removeText
                            ]
                        ) {

                            await sock.sendMessage(from, {
                                text:
`"${removeText}" tidak ditemukan`
                            })

                            return
                        }

                        clearInterval(
                            autoChats[
                                removeText
                            ]
                        )

                        delete autoChats[
                            removeText
                        ]

                        await sock.sendMessage(from, {
                            text:
`"${removeText}" berhasil dinonaktifkan`
                        })
                    }
                }

                // ======================
                // 📦 DATA USER
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
                // 🎯 ANTI SPAM STICKER
                // ======================

                if (isSticker) {

                    const now = Date.now()

                    // reset kalau jeda >30 detik
                    if (
                        now -
                        userTracker[sender]
                            .lastSticker >
                        30000
                    ) {

                        userTracker[sender]
                            .count = 0
                    }

                    // update waktu terakhir
                    userTracker[sender]
                        .lastSticker = now

                    // tambah count
                    userTracker[sender]
                        .count++

                    // 5 sticker cepat
                    if (
                        userTracker[sender]
                            .count >= 5
                    ) {

                        userTracker[sender]
                            .count = 0

                        userTracker[sender]
                            .violations++

                        let namaUser =
                            sender.split("@")[0]

                        let jumlah =
                            userTracker[sender]
                                .violations

                        await sock.sendMessage(
                            from,
                            {
                                text:
`woy @${namaUser} asu, please stop spam sticker 5× berturut2 ya anak anj, sekarang pelanggaran kamu:(${jumlah})`,
                                mentions: [sender]
                            }
                        )

                        setResetTimer(
                            sender,
                            from
                        )
                    }

                } else {

                    // reset count sticker
                    userTracker[sender]
                        .count = 0
                }

                // ======================
                // 🔗 ANTI LINK
                // ======================

                if (isLink) {

await sock.sendMessage(from, {
    delete: msg.key
})

                    userTracker[sender]
                        .violations++

                    let namaUser =
                        sender.split("@")[0]

                    let jumlah =
                        userTracker[sender]
                            .violations

                    await sock.sendMessage(
                        from,
                        {
                            text:
`woy @${namaUser} asu, stop kirim link ya anak anj, Pelanggaran kamu sekarang:(${jumlah})`,
                            mentions: [sender]
                        }
                    )

                    setResetTimer(
                        sender,
                        from
                    )
                }

                // ======================
                // 👢 AUTO KICK
                // ======================

                if (
                    userTracker[sender]
                        .violations >= 5
                ) {

                    let namaUser =
                        sender.split("@")[0]

                    await sock.sendMessage(
                        from,
                        {
                            text:
`@${namaUser}  bye anak asu😹😹😹`,
                            mentions: [sender]
                        }
                    )

                    try {

                        // coba kick
                        await sock.groupParticipantsUpdate(
                            from,
                            [sender],
                            "remove"
                        )

                        console.log(
                            `bye ${namaUser}  anak asu😹😹😹`
                        )

                        // hapus data kalau sukses kick
                        delete userTracker[sender]

                    } catch (err) {

                        console.log(
                            "❌ Bot bukan admin / gagal kick:",
                            err
                        )

                        // tetap reset 2 jam
                        setResetTimer(
                            sender,
                            from
                        )
                    }
                }

            } catch (err) {

                console.log(
                    "❌ Error sistem:",
                    err
                )

            }
        }
    )
}

startBot()
