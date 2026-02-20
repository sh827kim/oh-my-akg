import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { getDb } from '@/lib/db';

// Simple in-memory fallback since we don't have vector store working yet
async function getContext() {
    const db = await getDb();
    // Fetch top 20 active projects with descriptions
    const res = await db.query<{ repo_name: string; type: string; description: string | null; visibility: string }>(`
    SELECT repo_name, type, description, visibility 
    FROM projects 
    WHERE visibility = 'VISIBLE' 
    LIMIT 30
  `);

    if (res.rows.length === 0) return "No projects found in the database.";

    return res.rows.map((p) =>
        `- [${p.type}] ${p.repo_name}: ${p.description || 'No description'}`
    ).join('\n');
}

export async function POST(req: NextRequest) {
    try {
        const { messages } = await req.json() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
        if (!Array.isArray(messages)) {
            return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
        }
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage) {
            return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
        }

        const context = await getContext();

        const systemPrompt = `You are an intelligent architecture assistant for the "Module Health Radar" system.
    You have access to the following project inventory (partial list):
    
    ${context}
    
    Answer the user's question about the system architecture, dependencies, or specific projects.
    If you don't know the answer based on the provided context, admit it.
    Keep answers concise and helpful.
    `;

        // Determine which provider to use
        let chatModel;
        if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_API_INSTANCE_NAME) {
            chatModel = new AzureChatOpenAI({
                azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
                azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
                azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
                azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || "2023-05-15",
                temperature: 0.7,
            });
        } else {
            chatModel = new ChatOpenAI({
                openAIApiKey: process.env.OPENAI_API_KEY,
                modelName: 'gpt-4o',
                temperature: 0.7,
            });
        }

        const chatMessages = [
            new SystemMessage(systemPrompt),
            ...messages.map((m) =>
                m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
            )
        ];

        const response = await chatModel.invoke(chatMessages);

        return NextResponse.json({ content: response.content });

    } catch (error: unknown) {
        console.error('Chat API Error:', error);
        return NextResponse.json({
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
