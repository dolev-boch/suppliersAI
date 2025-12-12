export default function handler(req, res) {
  // Enable CORS for your domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Return the API key from environment variable
  res.status(200).json({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  });
}
