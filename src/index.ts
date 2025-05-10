import axios from 'axios'
import express from 'express'
import fs from 'fs'
import path from 'path'
import qr from 'qrcode-terminal'
import { Client, LocalAuth } from 'whatsapp-web.js'
import getCountryName from './utils/getCountryName'

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'em-waissist' })
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
        content: `You are an AI assistant replying to WhatsApp messages on behalf of the user. Keep replies friendly and brief. Let them know, I, Eko, am not available at the moment.`
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
    try {
        const response = await axios.post("http://103.245.38.118:11435/api/chat", {
            model: "deepseek-r1:1.5b",
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

client.on("message", async m => {
    const about = fs.readFileSync(aboutFilePath, 'utf-8')
    if(about === 'Not available') {
        if(m.type === 'chat') {
            const chatHistoryFilePath = path.join(chatsPath, `${m.from.split('@')[0]}.json`)
            if(!fs.existsSync(chatHistoryFilePath)) {
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
            if(chatHistory.length < 1) {
                chatHistory.push(instructions(`+${m.from.split('@')[0]}`))
            }
            chatHistory.push({
                role: 'user',
                content: m.body
            })
            const aiReply = await sendToAi(chatHistory)
            m.reply(aiReply)
        }
    }
})

app.listen(PORT, () => {
    if (!fs.existsSync(chatsPath)) {
        fs.mkdirSync(chatsPath)
    }
    console.log('App running on:', PORT)
})