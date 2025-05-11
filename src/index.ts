import axios from "axios";
import express from "express";
import fs from "fs";
import path from "path";
import qr from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
import getCountryName from "./utils/getCountryName";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "em-waissist" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

const app = express();
const chatsDir = "./chats";
const aboutFileName = "about.txt";
const aboutFilePath = path.join(__dirname, aboutFileName);
const chatsPath = path.join(__dirname, chatsDir);

const instructions = (
  phoneNumber: string
): {
  role: "system" | "user" | "assistant";
  content: string;
} => {
  const countryName = getCountryName(phoneNumber);
  return {
    role: "system",
    content: `You are an AI assistant replying to WhatsApp messages on behalf of the user. Keep replies friendly and brief. Let them know you are an AI assitant of mine and I, Eko, am not available at the moment.`,
  };
};

const PORT = process.env.PORT || 8081;

client.on("qr", (qrcode) => {
  qr.generate(qrcode, {
    small: true,
  });
});

client.on("ready", async () => {
  console.log("✅ WhatsApp client is ready");
  const info = client.info;
  const numberId = info.wid._serialized;
  const contact = await client.getContactById(numberId);
  const about = await contact.getAbout();
  console.log(numberId, contact, about);
  if (about) {
    fs.writeFileSync(aboutFilePath, about || "", {
      encoding: "utf-8",
    });
  }
});

client.on("authenticated", () => {
  console.log("✅ WhatsApp client is authenticated");
});

app.get("/", async (req, res) => {
  res.json("hello world!");
});

app.get("/activate-ai", async (req, res) => {
  await client.setStatus("Not available");
  res.send("AI Assistant is activated");
  fs.writeFileSync(aboutFilePath, "Not available", "utf-8");
});

app.get("/deactivate-ai", async (req, res) => {
  await client.setStatus("Available");
  res.send("AI Assistant is deactivated");
  fs.writeFileSync(aboutFilePath, "Available", "utf-8");
});

app.get("/assist-history/:number", async (req, res) => {
  const chatPathFile = path.join(chatsPath, `${req.params.number}.json`)
  const chats = JSON.parse(fs.readFileSync(chatPathFile, 'utf-8') ?? '[]')
  res.json(chats)
})

app.get('/clear-assist-history/:number', async (req, res) => {
  const chatPathFile = path.join(chatsPath, `${req.params.number}.json`)
  if(!fs.existsSync(chatPathFile)) {
    res.send('No assist history found')
  } else{
    fs.writeFileSync(chatPathFile, '[]', 'utf-8')
    res.send('Assist history is cleared')
  }
})

const sendToAi = async (
  messages: {
    role: "user" | "system" | "assistant";
    content: string;
  }[],
  signal: AbortSignal
): Promise<string> => {
  console.log("Requesting AI reply...");
  try {
    const response = await axios.post(
      `${process.env.OLLAMA_HOST}/api/chat`,
      {
        model: process.env.OLLAMA_MODEL,
        messages: messages,
        stream: false,
      },
      {
        // headers: { "Content-Type": "application/json" },
        headers: {
          "Content-Type": "application/json",
        },
        signal,
      }
    );
    console.log(response.data);
    return response.data?.message.content
      .replace(/<think>.*?<\/think>/gs, "")
      .trim();
  } catch (e) {
    console.error(e);
    return "";
  }
};

client.initialize();

const userDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
const userCancelAiFecths: Map<string, AbortController> = new Map();
client.on("message", async (m) => {
  const control = new AbortController();
  const signal = control.signal;

  const senderId = m.from;
  if (senderId.includes("@g.us")) return;
  if (userDebounceTimers.has(senderId))
    clearTimeout(userDebounceTimers.get(senderId));
  if (userCancelAiFecths.has(senderId))
    userCancelAiFecths.get(senderId)?.abort();
  const about = fs.readFileSync(aboutFilePath, "utf-8");
  if (about === "Not available") {
    if (m.type === "chat") {
      console.log(m.from, m.body);
      const chatHistoryFilePath = path.join(
        chatsPath,
        `${m.from.split("@")[0]}.json`
      );
      if (!fs.existsSync(chatHistoryFilePath)) {
        fs.writeFileSync(
          chatHistoryFilePath,
          JSON.stringify([instructions(`+${m.from.split("@")[0]}`)]),
          "utf-8"
        );
      }
      const chatHistory: {
        role: "system" | "user" | "assistant";
        content: string;
      }[] = JSON.parse(fs.readFileSync(chatHistoryFilePath, "utf-8") ?? "[]");
      if (chatHistory.length < 1) {
        chatHistory.push(instructions(`+${m.from.split("@")[0]}`));
      }
      const latestChat = chatHistory.at(-1);
      if (latestChat?.role === "user") {
        chatHistory.pop();
        chatHistory.push({
          role: "user",
          content: `${latestChat.content}\n${m.body}`,
        });
      } else {
        chatHistory.push({
          role: "user",
          content: m.body,
        });
      }
      fs.writeFileSync(
        chatHistoryFilePath,
        JSON.stringify(chatHistory),
        "utf-8"
      );
      const latestChat2 = chatHistory.at(-1);
      if (latestChat2?.role === "user") {
        const timer = setTimeout(async () => {
          userDebounceTimers.delete(senderId);
          (await m.getChat()).sendStateTyping()
          const aiReply = await sendToAi(chatHistory, signal);
          chatHistory.push({
            role: "assistant",
            content: aiReply,
          });
          (await m.getChat()).sendStateTyping()
          fs.writeFileSync(
            chatHistoryFilePath,
            JSON.stringify(chatHistory),
            "utf-8"
          );
          if (aiReply) m.reply(aiReply);
          userCancelAiFecths.delete(senderId);
        }, 8000);
        userCancelAiFecths.set(senderId, control);
        userDebounceTimers.set(senderId, timer);
      }
    }
  }
});

app.listen(PORT, () => {
  if (!fs.existsSync(chatsPath)) {
    fs.mkdirSync(chatsPath);
  }
  if (!fs.existsSync(aboutFilePath)) {
    fs.writeFileSync(aboutFilePath, "", {
      encoding: "utf-8",
    });
  }
  console.log("App running on:", PORT);
});
