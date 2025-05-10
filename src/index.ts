import axios from 'axios'
import express from 'express'
import fs from 'fs'
import path from 'path'
import qr from 'qrcode-terminal'
import { Client, LocalAuth } from 'whatsapp-web.js'
import getCountryName from './utils/getCountryName'

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'em-waissist' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }

})

const app = express()
const chatsDir = './chats'
const aboutFileName = 'about.txt'
const aboutFilePath = path.join(__dirname, aboutFileName)
const chatsPath = path.join(__dirname, chatsDir)

const instructions = (phoneNumber: string): {
    role: 'system' | 'user' | 'assistant'
    content: string
} => {
    const countryName = getCountryName(phoneNumber);
    return {
        role: "system",
        content: `You are an AI assistant replying to WhatsApp messages on behalf of the user. Keep replies friendly and brief. Let them know you are an AI assitant of mine and I, Eko, am not available at the moment.`
    }
}

const PORT = process.env.PORT || 8081

client.on('qr', (qrcode) => {
    qr.generate(qrcode, {
        small: true
    })
})

client.on("ready", async () => {
    console.log("✅ WhatsApp client is ready");
    const info = client.info
    const numberId = info.wid._serialized
    const contact = await client.getContactById(numberId)
    const about = await contact.getAbout()
    console.log(numberId, contact, about)
    fs.writeFileSync(aboutFilePath, about || '', {
        encoding: 'utf-8'
    })
});


client.on("authenticated", () => {
    console.log("✅ WhatsApp client is authenticated");
});

app.use("/", async (req, res) => {
    const response = await sendToAi([
        {
            role: 'user',
            content: "Hello"
        }
    ])
    res.json(response)
})

const sendToAi = async (
    messages: {
        role: 'user' | 'system' | 'assistant'
        content: string
    }[]
): Promise<string> => {
    console.log('Fetch AI reply...')
    try {
        const response = await axios.post(`${process.env.OLLAMA_HOST}/api/chat`, {
            model: process.env.OLLAMA_MODEL,
            messages: messages,
            stream: false
        }, {
            // headers: { "Content-Type": "application/json" },
            headers: {
                "Content-Type": "application/json"
            }
        });
        console.log(response.data)
        return response.data?.message.content.replace(/<think>.*?<\/think>/gs, '').trim()
    } catch (e) {
        console.error(e)
        return 'AI is not available now, please try again later'
    }
}

client.initialize()

const userDebounceTimers: Map<string, NodeJS.Timeout> = new Map()
client.on("message", async m => {
    const senderId = m.from
    if (senderId.includes('@g.us')) return
	if (userDebounceTimers.has(senderId)) clearTimeout(userDebounceTimers.get(senderId))
    const about = fs.readFileSync(aboutFilePath, 'utf-8')
    if (about === 'Not available' || true) {
        if (m.type === 'chat') {
            console.log(m.from, m.body)
            const chatHistoryFilePath = path.join(chatsPath, `${m.from.split('@')[0]}.json`)
            if (!fs.existsSync(chatHistoryFilePath)) {
                fs.writeFileSync(chatHistoryFilePath, JSON.stringify(
                    [
                        instructions(`+${m.from.split('@')[0]}`)
                    ]
                ), 'utf-8')
            }
            const chatHistory: {
                role: 'system' | 'user' | 'assistant',
                content: string
            }[] = JSON.parse(fs.readFileSync(chatHistoryFilePath, 'utf-8') ?? '[]')
            if (chatHistory.length < 1) {
                chatHistory.push(instructions(`+${m.from.split('@')[0]}`))
            }
            const latestChat = chatHistory.at(-1)
            if (latestChat?.role === 'user') {
                chatHistory.pop()
                chatHistory.push({
                    role: 'user',
                    content: `${latestChat.content}\n${m.body}`
                })
            } else {
                chatHistory.push({
                    role: 'user',
                    content: m.body
                })
            }
            fs.writeFileSync(chatHistoryFilePath, JSON.stringify(chatHistory), 'utf-8')
            const timer = setTimeout(async () => {
                userDebounceTimers.delete(senderId)
                const aiReply = await sendToAi(chatHistory)
                chatHistory.push({
                    role: 'assistant',
                    content: aiReply
                })
                fs.writeFileSync(chatHistoryFilePath, JSON.stringify(chatHistory), 'utf-8')
                m.reply(aiReply)
            }, 8000)
            userDebounceTimers.set(senderId, timer);
        }
    }
})

app.listen(PORT, () => {
    if (!fs.existsSync(chatsPath)) {
        fs.mkdirSync(chatsPath)
    }
    console.log('App running on:', PORT)
})
