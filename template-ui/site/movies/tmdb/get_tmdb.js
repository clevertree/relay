// Fetch TMDB movie details by id (browser). Uses public env from POST /env.
import { loadEnvOnce, tmdbAuth } from './query_tmdb.js';

export async function getTmdbById(id) {
  const env = await loadEnvOnce();
  const { headers, urlSuffix } = tmdbAuth(env);
  if (!headers.Authorization && typeof urlSuffix !== 'function') return null;
  const movieId = String(id || '').trim();
  if (!movieId) return null;
  let url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(movieId)}?language=en-US`;
  url += typeof urlSuffix === 'function' ? urlSuffix(url) : '';
  const resp = await fetch(url, { headers });
  if (!resp.ok) return null;
  const r = await resp.json();
  const title = r.title || r.original_title || '';
  const release_date = r.release_date || undefined;
  const release_year = r.release_date ? Number((r.release_date || '').slice(0, 4)) : undefined;
  const url_poster = r.poster_path ? ('https://image.tmdb.org/t/p/w500' + r.poster_path) : undefined;
  const url_backdrop = r.backdrop_path ? ('https://image.tmdb.org/t/p/w780' + r.backdrop_path) : undefined;
  const overview = r.overview;
  const genres = Array.isArray(r.genres) ? r.genres.map(g => g.name).filter(Boolean) : undefined;
  return { id: movieId, title, release_date, release_year, url_poster, url_backdrop, overview, genre: genres, source: 'tmdb' };
}
