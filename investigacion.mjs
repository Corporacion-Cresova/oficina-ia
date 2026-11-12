// Investigación de mercado para el equipo de Marketing. La llave vive en el
// servidor: el agente solo recibe los resultados.
const API = 'https://www.googleapis.com/youtube/v3';

async function yt(path, params) {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) throw new Error('Falta la llave de YouTube Data API: Diego la carga en Sistema → Llaves.');
  const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube respondió ${res.status}: ${data.error?.message?.slice(0, 160) || 'sin detalle'}`);
  return data;
}

// Shorts más vistos de un tema en un país y período, con sus estadísticas.
export async function searchShorts({ q, region, days = 90, lang = 'es', max = 15 }) {
  const after = new Date(Date.now() - days * 86_400_000).toISOString();
  const found = await yt('search', {
    part: 'snippet', type: 'video', videoDuration: 'short', order: 'viewCount', maxResults: String(Math.min(25, max)),
    q: `${q} #shorts`, regionCode: region, relevanceLanguage: lang, publishedAfter: after,
  });
  const ids = (found.items || []).map((i) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const stats = await yt('videos', { part: 'snippet,statistics,contentDetails', id: ids.join(',') });
  return (stats.items || []).map((v) => ({
    title: v.snippet.title,
    channel: v.snippet.channelTitle,
    published: v.snippet.publishedAt.slice(0, 10),
    views: Number(v.statistics.viewCount || 0),
    likes: Number(v.statistics.likeCount || 0),
    comments: Number(v.statistics.commentCount || 0),
    url: `https://youtube.com/shorts/${v.id}`,
  })).sort((a, b) => b.views - a.views);
}
