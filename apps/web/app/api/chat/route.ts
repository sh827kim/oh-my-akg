import { NextRequest, NextResponse } from 'next/server';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { getDb } from '@archi-navi/core';
import { getProjectTypeFromMetadata } from '@archi-navi/core';

async function getContext() {
  const db = await getDb();
  const res = await db.query<{
    name: string;
    display_name: string | null;
    metadata: unknown;
    visibility: string;
  }>(`
    SELECT name, display_name, metadata, visibility
    FROM objects
    WHERE workspace_id = 'default'
      AND object_type = 'service'
      AND visibility = 'VISIBLE'
    LIMIT 30
  `);

  if (res.rows.length === 0) return 'No services found in the database.';

  return res.rows
    .map((p) => {
      const metadata = (p.metadata && typeof p.metadata === 'object')
        ? (p.metadata as Record<string, unknown>)
        : {};
      const label = p.display_name?.trim() ? p.display_name : p.name;
      const type = getProjectTypeFromMetadata(metadata);
      const description = typeof metadata.description === 'string' ? metadata.description : 'No description';
      return `- [${type}] ${label}: ${description}`;
    })
    .join('\n');
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = (await req.json()) as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages must be an array' }, { status: 400 });
    }
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return NextResponse.json({ error: 'No messages provided' }, { status: 400 });
    }

    const context = await getContext();

    const systemPrompt = `You are an intelligent architecture assistant for the "Archi.Navi" system.
You have access to the following service inventory (partial list):

${context}

Answer the user's question about the system architecture, dependencies, or specific services.
If you don't know the answer based on the provided context, admit it.
Keep answers concise and helpful.
`;

    let chatModel;
    if (process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_API_INSTANCE_NAME) {
      chatModel = new AzureChatOpenAI({
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2023-05-15',
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
      ...messages.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
    ];

    const response = await chatModel.invoke(chatMessages);

    return NextResponse.json({ content: response.content });
  } catch (error: unknown) {
    console.error('Chat API Error:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
