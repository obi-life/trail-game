const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
require('dotenv').config();
const fs = require("fs");


const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? false  // No CORS needed - same domain
    : ['http://localhost:3000', 'http://127.0.0.1:8081', 'http://localhost:8080']
}));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});



app.post("/api/generate-pdf", async (req, res) => {
  let browser;
  try {
    const { kidName, kidAge, kidGender, poppedCategories, learningContent, theme } = req.body;


    // console.log('Request body:', req.body);
    

    if (!kidName || !learningContent) {
      return res.status(400).json({
        error: "Missing required fields: kidName and learningContent are required",
      });
    }

    // --- Build HTML content ---
    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Learning Trail for ${kidName}</title>
      <link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@300;400;700&display=swap" rel="stylesheet">
      <style>
        body { font-family: 'Comic Neue', cursive, Arial, sans-serif; line-height: 1.6; padding: 40px 20px; }
        h1, h3, h4 { margin: 0 0 10px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { color: #ee4422; font-size: 2.5rem; font-weight: bold; }
        .subtitle { color: #666; margin-top: 5px; }
        .categories { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
        .category-tag { background: #ee4422; color: #fff; padding: 4px 10px; border-radius: 15px; font-size: 0.9rem; }
        .activity-section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 10px; }
        strong { color: #ee4422; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1 class="title">🎓 Learning Trail</h1>
        <div class="subtitle">For ${kidName} (Age ${kidAge}, ${kidGender || "🌈"})</div>
        <div>Generated: ${new Date().toLocaleDateString()}</div>
      </div>

      <h3>🎮 Game Summary</h3>
      <p><strong>Theme:</strong> ${theme || "Mixed Topics"}</p>
      <div class="categories">
        ${(poppedCategories || [])
          .map((cat) => `<span class="category-tag">${cat}</span>`)
          .join("")}
      </div>

      <h3>📚 Learning Activities</h3>
      <div class="activity-section">
        ${learningContent
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
          .replace(/\n\n/g, "</div><div class='activity-section'>")
          .replace(/\n/g, "<br>")}
      </div>

      <footer style="margin-top:40px; text-align:center; font-size:0.9rem; color:#666;">
        <p>🌟 Created with love by OBI Learning 🌟</p>
        <p><a href="http://www.obi.life">www.obi.life</a> | +91 7676816124</p>
      </footer>
    </body>
    </html>`;

    // --- Puppeteer Launch (Vercel-optimized) ---
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    await page.evaluateHandle("document.fonts.ready"); // ✅ wait for fonts

    // --- Generate PDF ---
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
    });

    // --- Debug save (server-side) ---
    // fs.writeFileSync("debug.pdf", pdfBuffer);
    // console.log("PDF written to debug.pdf");

    // --- Send response properly ---
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Learning_Trail_${kidName.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date()
        .toISOString()
        .split("T")[0]}.pdf"`
    );
    res.setHeader("Content-Length", Buffer.byteLength(pdfBuffer));
    res.write(pdfBuffer);
    res.end();
  } catch (err) {
    console.error("PDF generation error:", err);
    res.status(500).json({ error: "Failed to generate PDF", details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});





// OpenAI proxy endpoint
app.post('/api/openai', async (req, res) => {
  try {
    const { messages, model = 'gpt-4o-mini-2024-07-18' } = req.body;

    // Validate request
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ 
        error: 'Invalid request: messages array is required' 
      });
    }

    // Rate limiting (simple implementation)
    const userIP = req.ip;
    // In production, use Redis or database for rate limiting
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error('OpenAI API error:', error);
    res.status(500).json({ 
      error: 'Failed to process request',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});