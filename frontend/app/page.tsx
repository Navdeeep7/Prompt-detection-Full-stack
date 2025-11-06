'use client';
import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { Send, Loader2, CheckCircle2 } from "lucide-react";

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful assistant.");
  const [userPrompt, setUserPrompt] = useState("How do I make a cake?");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    // const newSocket = io("http://localhost:3001");
    const socketUrl ="https://prompt-detection-backend.onrender.com/";
    const newSocket = io(socketUrl);
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to backend! Socket ID:", newSocket.id);
    });

    newSocket.on("classification_result", (data) => {
      console.log("Result received from backend:", data);
      setResult(data.result);
      setLoading(false);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!socket || !socket.connected) {
      alert("Socket not connected!");
      return;
    }

    setLoading(true);
    setResult(null);
    
    socket.emit("classify_prompt", {
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-4xl font-light text-slate-800 mb-2">
            Prompt Classification
          </h1>
          <p className="text-slate-500 text-sm">
            Analyze and classify your prompts in real-time
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* System Prompt */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <label className="block text-sm font-medium text-slate-700 mb-3">
              System Prompt
            </label>
            <textarea 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)} 
              className="w-full px-4 py-3 text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all resize-none"
              rows={3}
              placeholder="Enter system prompt..."
            />
          </div>

          {/* User Prompt */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <label className="block text-sm font-medium text-slate-700 mb-3">
              User Prompt
            </label>
            <textarea 
              value={userPrompt} 
              onChange={(e) => setUserPrompt(e.target.value)} 
              className="w-full px-4 py-3 text-slate-800 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all resize-none"
              rows={4}
              placeholder="Enter user prompt..."
            />
          </div>

          {/* Submit Button */}
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-700 disabled:bg-slate-400 text-white font-medium py-4 px-6 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Classifying...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Classify Prompt
              </>
            )}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-medium text-slate-800">
                Classification Result
              </h3>
            </div>
            <pre className="bg-slate-50 text-slate-800 p-4 rounded-lg text-sm overflow-x-auto border border-slate-200 font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}