import { Buffer } from 'buffer';       
import pkg from 'stremio-addon-sdk';
const { addonBuilder, serveHTTP } = pkg;
import { load } from 'cheerio';        
import axios from 'axios';             
import dotenv from 'dotenv';
import { URL } from 'url'; 
import vm from 'vm'; 
// --- Configuración Inicial ---
dotenv.config();
const PELISPLUS_DOMAIN = 'https://ww3.pelisplus.to';

// --- Manifest (Versión actualizada) ---
const manifest = {
    id: 'org.pelisplus.catalogos.final',
    version: '1.1.0', 
    name: 'Pelis HD LATINO',
    description: 'Addon Para ver peliculas, series, animes y doramas de PelisPlus en español latino.',
    logo: 'https://png.pngtree.com/element_our/20190603/ourlarge/pngtree-movie-board-icon-image_1455346.jpg',
    idPrefixes: [ 'pplus:' ],
    resources: [ 'catalog', 'meta', 'stream' ],
    types: ['movie', 'series'],
    catalogs: [
        { id: 'pplus-peliculas', type: 'movie',  name: 'PelisPlus Películas', extra: [{ name: 'skip' }, { name: 'search', isRequired: false }] },
        { id: 'pplus-series',    type: 'series', name: 'PelisPlus Series',   extra: [{ name: 'skip' }, { name: 'search', isRequired: false }] },
        { id: 'pplus-animes',    type: 'series', name: 'PelisPlus Animes',   extra: [{ name: 'skip' }, { name: 'search', isRequired: false }] },
        { id: 'pplus-doramas',   type: 'series', name: 'PelisPlus Doramas',  extra: [{ name: 'skip' }, { name: 'search', isRequired: false }] }
    ],
    behaviorHints: {
        adult: false,
        paged: true
    }
};

// --- Inicialización del Addon ---
const builder = new addonBuilder(manifest);

// --- Mapeo de Catálogos y Selectores ---
const CATALOG_MAP = {
    'pplus-peliculas': { urlPath: '/peliculas', type: 'movie', linkPrefix: '/pelicula/' },
    'pplus-series':    { urlPath: '/series',    type: 'series',  linkPrefix: '/serie/' },
    'pplus-animes':    { urlPath: '/animes',    type: 'series',  linkPrefix: '/anime/' },
    'pplus-doramas':   { urlPath: '/doramas',   type: 'series',  linkPrefix: '/serie/' }
};

// Selectores para el catálogo (estos funcionan bien)
const SELECTORS = {
    catalog: {
        itemContainer: 'article.item',
        linkElement: 'a.itemA',
        titleElement: 'h2',
        posterElement: 'div.item__image img',
        posterAttribute: 'data-src',
        pathAttribute: 'href'
    },
    search: { // Selectores CORREGIDOS para búsqueda basados en el último log HTML
        itemContainer: 'article.item.liste', // Contenedor: article con clases item Y liste
        linkElement: 'a.itemA',              // Enlace dentro del contenedor
        titleElement: 'h2',                  // Título (es h2, no h3) dentro del enlace
        posterElement: 'div.item__image img',// Imagen (más específico)
        posterAttribute: 'data-src',         // Atributo para la URL del poster (correcto)
        pathAttribute: 'href'                // Atributo para el path (correcto)
    }
};

const ITEMS_PER_PAGE = 24;

// --- HANDLER DE CATÁLOGO (con Selectores de Búsqueda Corregidos y Logs Limpios) ---
builder.defineCatalogHandler(async (args) => {
    const { type, id, extra } = args;
    const searchQuery = extra?.search;
    const skipRaw = extra?.skip;
    const skip = parseInt(skipRaw || '0', 10);

    console.log(`>>> Solicitud Catálogo: type=${type}, id=${id}, skip=${skip}, search='${searchQuery || ''}'`);

    const metas = [];

    if (searchQuery) {
        // ========== LÓGICA DE BÚSQUEDA ==========
        console.log(`   [${id}] Iniciando búsqueda para: "${searchQuery}"`);
        const searchUrl = `${PELISPLUS_DOMAIN}/search/${encodeURIComponent(searchQuery)}`;
        console.log(`   [${id}] Buscando en URL: ${searchUrl}`);

        try {
            const response = await axios.get(searchUrl, {
                headers: { /* ... tus headers ... */
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                 },
                 timeout: 15000
            });
            const html = response.data;
            const $ = load(html);
            // console.log(`   [${id}] HTML de búsqueda descargado.`); // Log reducido

            // Usar los selectores CORREGIDOS de búsqueda
            const searchSelectors = SELECTORS.search;
            const itemContainers = $(searchSelectors.itemContainer); // Seleccionar contenedores

            console.log(`   [${id}] Parseando HTML con selector '${searchSelectors.itemContainer}'. Encontrados: ${itemContainers.length}`); // Log de conteo

            itemContainers.each((i, element) => { // Iterar sobre los contenedores encontrados
                const $container = $(element);
                // Buscar elementos DENTRO del contenedor actual
                const linkElement = $container.find(searchSelectors.linkElement);
                const titleElement = linkElement.find(searchSelectors.titleElement); // Buscar h2 dentro del enlace
                const posterElement = $container.find(searchSelectors.posterElement); // Buscar img dentro del div.item__image

                const path = linkElement.attr(searchSelectors.pathAttribute);
                const title = titleElement.text().trim();
                let poster = posterElement.attr(searchSelectors.posterAttribute) || posterElement.attr('src');
                 if (poster && poster.startsWith('//')) { poster = `https:${poster}`; }

                if (path && title && poster) {
                    try {
                        const absolutePath = path.startsWith('http') ? path : `${PELISPLUS_DOMAIN}${path.startsWith('/') ? path : '/' + path}`;
                        const urlObject = new URL(absolutePath);
                        const pathSegments = urlObject.pathname.split('/').filter(Boolean);
                        const typeFromPath = pathSegments[0];

                        let resultType = '';
                        if (typeFromPath === 'pelicula') {
                            resultType = 'movie';
                        } else if (['serie', 'anime'].includes(typeFromPath)) {
                             resultType = 'series';
                            } else { return; } // Saltar si no es tipo conocido

                            if (resultType !== type) { return; } // Saltar si no coincide con el tipo del catálogo

                        const slug = pathSegments.slice(1).join(':');
                        const internalId = `pplus:${typeFromPath}:${slug}`;

                        metas.push({
                            id: internalId,
                            type: resultType,
                            name: title,
                            poster: poster
                        });
                    } catch (urlError) {
                         console.warn(`   [${id}] Error parseando URL/ID en búsqueda: ${path}`, urlError.message);
                    }
                }
            });
            console.log(`   [${id}] Búsqueda finalizada. Resultados parseados: ${metas.length}`);

        } catch (error) {
            console.error(`   ❌ [${id}] ERROR Axios/Cheerio en Búsqueda para "${searchQuery}":`, error.message);
             if (error.response) { console.error(`       -> Status: ${error.response.status}`); }
            return Promise.resolve({ metas: [] });
        }

    } else {
        // ========== LÓGICA DE NAVEGACIÓN (CATÁLOGO NORMAL - SIN CAMBIOS) ==========
        // Tu código existente para navegar catálogos...
        console.log(`   [${id}] Navegando catálogo (sin búsqueda). Skip=${skip}`);
        const catalogInfo = CATALOG_MAP[id];
        if (!catalogInfo || catalogInfo.type !== type) { return Promise.resolve({ metas: [] }); }
        const pageNumber = Math.floor(skip / ITEMS_PER_PAGE) + 1;
        let targetUrl = `${PELISPLUS_DOMAIN}${catalogInfo.urlPath}`;
        if (pageNumber > 1) { targetUrl += `/${pageNumber}`; }
        // console.log(`   [${id}] URL Catálogo: ${targetUrl}`); // Log opcional

        try {
            const response = await axios.get(targetUrl, { /* ... headers, timeout ... */
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                timeout: 15000
           });
            const html = response.data;
            const $ = load(html);
            const expectedPathPrefix = catalogInfo.linkPrefix;
            const catalogSelectors = SELECTORS.catalog;

            $(catalogSelectors.itemContainer).each((i, element) => {
                // ... (tu código existente para extraer metas del catálogo) ...
                 const $container = $(element);
                 const linkElement = $container.find(catalogSelectors.linkElement);
                 const titleElement = linkElement.find(catalogSelectors.titleElement);
                 const posterElement = linkElement.find(catalogSelectors.posterElement);
                 const path = linkElement.attr(catalogSelectors.pathAttribute);
                 const title = titleElement.text().trim();
                 let poster = posterElement.attr(catalogSelectors.posterAttribute) || posterElement.attr('src');
                 if (path && title && poster && expectedPathPrefix && path.includes(expectedPathPrefix)) {
                     try {
                         const absolutePath = path.startsWith('http') ? path : `${PELISPLUS_DOMAIN}${path.startsWith('/') ? path : '/' + path}`;
                         const urlObject = new URL(absolutePath);
                         const pathSegments = urlObject.pathname.split('/').filter(Boolean);
                         const typeFromPath = pathSegments[0];
                         const slug = pathSegments.slice(1).join(':');
                         const internalId = `pplus:${typeFromPath}:${slug}`;
                         const finalPoster = poster && poster.startsWith('//') ? `https:${poster}` : poster;
                         metas.push({ id: internalId, type: catalogInfo.type, name: title, poster: finalPoster });
                     } catch (urlError) { console.warn(`[${id}] Error parseando URL/ID en catálogo: ${path}`, urlError.message); }
                 }
            });
             // console.log(`   [${id}] Parseo Catálogo finalizado. Items: ${metas.length}`); // Log opcional
        } catch (error) {
            console.error(`   ❌ [${id}] ERROR Axios/Cheerio en Catálogo:`, error.message);
             if (error.response) { console.error(`       -> Status: ${error.response.status}`); }
            return Promise.resolve({ metas: [] });
        }
    }

    console.log(`<<< Devolviendo ${metas.length} metas (search='${searchQuery || ''}', skip=${skip})`);
    return Promise.resolve({ metas });
});

// --- HANDLER DE METADATOS (CON SELECTORES FINALES) ---
builder.defineMetaHandler(async (args) => {
    console.log(">>> Solicitud de Meta Recibida:", JSON.stringify(args, null, 2));
    const { type, id } = args;

    // --- Reconstruir URL ---
    const idParts = id.split(':');
    if (idParts.length < 3 || idParts[0] !== 'pplus') { return Promise.resolve({ meta: null }); }
    const itemType = idParts[1];
    const itemSlug = idParts.slice(2).join('/');
    const path = `${itemType}/${itemSlug}`;
    const targetUrl = `${PELISPLUS_DOMAIN}/${path}`;
    console.log(`   [${id}] Obteniendo metadatos desde: ${targetUrl}`);

    try {
        // --- Descargar HTML ---
        const response = await axios.get(targetUrl, {
             headers: { /* ... Mismos headers ... */ },
             timeout: 15000
        });
        const html = response.data;
        console.log(`      -> HTML descargado para ${id}. Parseando...`);
        const $ = load(html);

        // --- Extracción con Selectores FINALES (Basados en image_d0e8db.png y image_d0dd5c.jpg) ---
        console.log(`      -> Extrayendo datos con Cheerio (Selectores Finales)...`);

        // Título: h1.slugh1
        const title = $('h1.slugh1').text().trim() || id;

        // Descripción: p dentro de div.description
        const description = $('div.description p').text().trim();

        // Año: Texto del link a[href*="/year/"] dentro de div.genres.rating
        let year = null;
        const yearText = $('div.genres.rating a[href*="/year/"]').first().text().trim();
        if (yearText) { year = parseInt(yearText.replace(/\D/g, '')); }
        // Fallback: extraer (YYYY) del título si no se encontró el link
        if (!year) {
            const yearMatch = title.match(/\((\d{4})\)$/);
            if (yearMatch && yearMatch[1]) { year = parseInt(yearMatch[1]); }
        }

        // Rating: Texto después de <b>Rating:</b>
        let imdbRating = null;
        try {
            const ratingNode = $('div.genres.rating b:contains("Rating:")').get(0)?.nextSibling;
            if (ratingNode?.type === 'text') { imdbRating = parseFloat(ratingNode.data.trim()); }
        } catch(e){}

        // Duración: Texto después de <b>Duración:</b>
        let runtime = null;
        try {
            const runtimeNode = $('div.genres.rating b:contains("Duración:")').get(0)?.nextSibling;
            if (runtimeNode?.type === 'text') { runtime = runtimeNode.data.trim(); }
        } catch(e){}

        // Géneros: Links <a> dentro de div.genres con href que contiene /genero/
        const genres = [];
        $('div.genres a[href*="/genero/"]').each((i, el) => {
            const genre = $(el).text().trim();
            if (genre) { genres.push(genre); }
        });

        // Director: Link <a> dentro de div.genres con href que contiene /director/
        let director = null;
        try {
            director = $('div.genres a[href*="/director/"]').first().text().trim();
        } catch(e){}

        // Reparto: Links <a> dentro de div.genres con href que contiene /actor/
        const cast = [];
         $('div.genres a[href*="/actor/"]').each((i, el) => {
            const actor = $(el).text().trim();
            if (actor) { cast.push(actor); }
        });

        // Póster: (Selector tentativo, ajustar si es necesario)
        const posterElement = $('div.item__image_page img');
        let poster = posterElement.attr('data-src') || posterElement.attr('src');
        if (poster && poster.startsWith('//')) { poster = `https:${poster}`; }

        // Background: URL del background-image en div.bg
        let background = null;
        const style = $('div.bg').attr('style'); // <-- CORREGIDO: Usa div.bg
        if (style) {
            const match = style.match(/background-image:\s*url\(['"]?([^'"]+)['"]?\)/);
            if (match && match[1]) {
                background = match[1];
                if (background.startsWith('/')) { background = `${PELISPLUS_DOMAIN}${background}`; }
                 else if (background.startsWith('//')) { background = `https:${background}`; }
            }
        }

        console.log(`      -> Datos Extraidos: Título='${title.substring(0,30)}...', Año=${year}, Géneros='${genres.join(', ')}', Rating=${imdbRating}`);
// --- INICIO EXTRACCIÓN EPISODIOS DESDE seasonsJson ---
const videos = []; // Array para guardar los episodios encontrados

// Solo buscar episodios si el TIPO solicitado es series, anime o dorama
if (type === 'series' || type === 'anime' || type === 'dorama') {
     console.log(`      -> [<span class="math-inline">\{id\}\] Tipo '</span>{type}'. Buscando seasonsJson en <script>...`);

     let seasonsData = null;
         let foundJsonScript = false;

         $('script').each((i, script) => { // Busca en TODAS las etiquetas <script>
             const scriptContent = $(script).html();
             // Busca el inicio de la definición de la variable
             if (scriptContent && scriptContent.includes('const seasonsJson = {')) {
                 foundJsonScript = true;
                 console.log(`         -> Script con seasonsJson encontrado. Extrayendo y parseando...`);
                 // Intenta extraer el objeto JSON (desde el '{' hasta el '};')
                 const match = scriptContent.match(/const\s+seasonsJson\s*=\s*({[\s\S]*?});/);
                 if (match && match[1]) {
                     const jsonString = match[1];
                     // Usa vm.runInNewContext para parsear de forma segura
                     try {
                         seasonsData = vm.runInNewContext(`(${jsonString})`, {}); // El () lo evalúa como expresión
                         console.log(`         -> ¡ÉXITO al parsear seasonsJson!`);
                     } catch (parseError) {
                         console.error(`         -> ERROR al parsear seasonsJson: ${parseError.message}`);
                         seasonsData = null;
                     }
                 } else {
                      console.error(`         -> No se pudo extraer el contenido {} de seasonsJson con la regex.`);
                 }
                 return false; // Detiene el loop .each() al encontrar el script
             }
         });

         if (!foundJsonScript) {
              console.log("         -> No se encontró el script con seasonsJson.");
         }

     if (seasonsData) {
        console.log(`         -> Procesando datos de seasonsJson...`);
        for (const seasonNum in seasonsData) { // Iterar temporadas ("1", "2", ...)
            if (seasonsData.hasOwnProperty(seasonNum)) {
                const seasonEpisodes = seasonsData[seasonNum]; // Array de episodios
                if (Array.isArray(seasonEpisodes)) {
                    seasonEpisodes.forEach(episodeData => { // Iterar episodios
                        if (episodeData.episode && episodeData.title) { // Datos mínimos
                           // CORRECTA:
                            const episodeStremioId = `${id}:${seasonNum}:${episodeData.episode}`;
                            const imagePath = episodeData.image;
                            // Construir URL completa de imagen (asume base TMDB)
                            const thumbnail = imagePath ? `https://image.tmdb.org/t/p/w500${imagePath}` : null;
                            // Construir título con SxxExx si no viene así
                            const finalEpTitle = `T${String(seasonNum).padStart(2, '0')}E${String(episodeData.episode).padStart(2, '0')}: ${episodeData.title}`;

                            const episodeObject = {
                                id: episodeStremioId,
                                title: finalEpTitle,
                                season: parseInt(seasonNum),
                                episode: episodeData.episode,
                                thumbnail: thumbnail && thumbnail.startsWith('//') ? `https:${thumbnail}` : thumbnail
                            };
                            // Limpiar nulos/vacíos
                            Object.keys(episodeObject).forEach(key => (!episodeObject[key] && episodeObject[key] !== 0) && delete episodeObject[key]);
                            videos.push(episodeObject);
                        }
                    });
                }
            }
        }
         // Ordenar episodios por temporada y luego por número
         videos.sort((a, b) => {
              if (a.season !== b.season) { return a.season - b.season; }
              return a.episode - b.episode;
         });
    }


     console.log(`      -> Se procesaron ${videos.length} episodios desde seasonsJson.`);
}
// --- FIN EXTRACCIÓN EPISODIOS ---

        // --- Construir Objeto Meta ---
        const metaObject = {
            id: args.id,
            type: args.type,
            name: title,
            poster: poster,
            background: background,
            description: description,
            releaseInfo: year ? String(year) : undefined, // Undefined si no hay año
            genres: genres.length > 0 ? genres : undefined,
            runtime: runtime,
            imdbRating: imdbRating, // Stremio usa imdbRating
            director: director ? [director] : undefined, // Director como array
            cast: cast.length > 0 ? cast : undefined, 
            ...(videos.length > 0 && { videos: videos })// Cast como array
        };

        // Eliminar propiedades undefined para un objeto más limpio
        Object.keys(metaObject).forEach(key => metaObject[key] === undefined && delete metaObject[key]);
        console.log(`      -> Añadiendo ${videos.length} videos al metaObject.`);
        console.log(`   [${id}] Metadatos procesados. Devolviendo meta.`);
        
        if (videos && videos.length > 0) {
            console.log(`   [${args.id}] Primeros IDs de episodios generados en 'videos':`);
            console.log(`       - ${videos[0]?.id}`);
            if (videos.length > 1) console.log(`       - ${videos[1]?.id}`);
        } else if (type === 'series') { // Solo loguea si es serie y no hay videos
             console.log(`   [${args.id}] ADVERTENCIA: No se generaron 'videos' para esta serie.`);
        }
        console.log(`   [${args.id}] Devolviendo meta object con ${videos?.length || 0} videos.`);

        return Promise.resolve({ meta: metaObject });

    } catch (error) {
        console.error(`   ❌ [${id}] ERROR Axios/Cheerio en Meta para URL: ${targetUrl}`);
         if (error.response) { console.error(`      -> Status Code: ${error.response.status}`); }
         else { console.error(`      -> Error: ${error.message}`); }
        return Promise.resolve({ meta: null });
    }
});


// --- HANDLER PARA STREAMS (v3 - Añadiendo Logs Detallados) ---
builder.defineStreamHandler(async (args) => {
    console.log(">>> Solicitud de Stream Recibida:", JSON.stringify(args, null, 2));
    const { type, id } = args;

    const idParts = id.split(':');
    let targetUrl = ''; // URL a la que haremos la petición

    if (idParts.length < 3 || idParts[0] !== 'pplus') {
        console.error(`   [${id}] ERROR Stream: ID inválido o formato incorrecto.`);
        return Promise.resolve({ streams: [] });
    }

    const itemTypeFromId = idParts[1];
    console.log(`   [${id}] Detectado tipo desde ID: ${itemTypeFromId}`); // <-- LOG tipo

    if (itemTypeFromId === 'pelicula') {
        if (idParts.length >= 3) {
            const itemSlug = idParts.slice(2).join(':');
            targetUrl = `${PELISPLUS_DOMAIN}/pelicula/${itemSlug}`;
            console.log(`   [${id}] CONSTRUYENDO URL Película: ${targetUrl}`); // <-- LOG URL Película
        } else {
            console.error(`   [${id}] ERROR Stream: ID de película inválido.`);
            return Promise.resolve({ streams: [] });
        }
    } else if (['serie', 'anime', 'dorama'].includes(itemTypeFromId)) {
        if (idParts.length === 5) {
            const itemSlug = idParts[2];
            const seasonNum = idParts[3];
            const episodeNum = idParts[4];
            const urlType = itemTypeFromId === 'dorama' ? 'serie' : itemTypeFromId; // Asume dorama -> serie
            targetUrl = `${PELISPLUS_DOMAIN}/${urlType}/${itemSlug}/season/${seasonNum}/episode/${episodeNum}`;
            console.log(`   [${id}] CONSTRUYENDO URL Episodio (${itemTypeFromId} S${seasonNum}E${episodeNum}): ${targetUrl}`); // <-- LOG URL Episodio
        } else {
            console.error(`   [${id}] ERROR Stream: ID de episodio (${itemTypeFromId}) no tiene 5 partes (formato esperado pplus:tipo:slug:T:E). Recibido: ${id}`);
            return Promise.resolve({ streams: [] });
        }
    } else {
        console.error(`   [${id}] ERROR Stream: Tipo de item desconocido en ID: ${itemTypeFromId}`);
        return Promise.resolve({ streams: [] });
    }

    if (!targetUrl) {
         console.error(`   [${id}] ERROR Stream: No se pudo construir targetUrl.`);
         return Promise.resolve({ streams: [] });
    }

    console.log(`   [${id}] ===> INTENTANDO OBTENER HTML DESDE: ${targetUrl}`); // <-- LOG URL FINAL

    const streams = [];
    try {
        const response = await axios.get(targetUrl, {
            headers: { /* Mismos headers */
                 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36',
                 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
                 'Accept-Language': 'en-US,en;q=0.9',
             },
             timeout: 15000,
             
        });

        console.log(`   [${id}] <=== Respuesta recibida de Axios. Status: ${response.status}`); // <-- LOG Status Code

        const html = response.data;
       
        console.log(`   [${id}] Inicio del HTML recibido (${targetUrl}):\n<<<<<<<<<<\n${typeof html === 'string' ? html.substring(0, 800) : '[HTML no es string]'}\n>>>>>>>>>>`); // <-- LOG Snippet HTML

        console.log(`   [${id}] Parseando HTML con Cheerio...`);
        const $ = load(html);

        const serverSelector = 'li[role="presentation"][data-server]';
        console.log(`   [${id}] Buscando servidores con selector: "${serverSelector}"`); // <-- LOG Selector
        const serverListItems = $(serverSelector);

        console.log(`   [${id}] ==> Selector encontró ${serverListItems.length} elementos.`); // <-- LOG CONTEO ENCONTRADO

        if (serverListItems.length > 0) {
            serverListItems.each((i, element) => {
                console.log(`   [${id}] ------ Procesando elemento encontrado #${i + 1} ------`); // <-- LOG Inicio Loop Each
                const $item = $(element);
                const dataServer = $item.attr('data-server');
                const serverName = $item.find('button').text().trim() || `Opción ${i + 1}`;

                if (dataServer) {
                    console.log(`       -> Opción: "${serverName}", data-server encontrado: ${dataServer.substring(0, 10)}...`); // <-- LOG data-server
                    try {
                        const encodedDataServer = Buffer.from(dataServer).toString('base64');
                        const finalPlayerUrl = `${PELISPLUS_DOMAIN}/player/${encodedDataServer}`;
                        console.log(`       -> URL Player: ${finalPlayerUrl}`); // <-- LOG URL Player

                        streams.push({
                            name: "PelisPlus",
                            type: type,
                            url: finalPlayerUrl,
                            title: `${serverName}`,
                        });
                    } catch (encodeError) {
                        console.error(`       -> ERROR codificando Base64: ${encodeError.message}`);
                    }
                } else {
                     console.warn(`       -> ADVERTENCIA: Elemento #${i+1} coincide con selector PERO no tiene atributo 'data-server'.`);
                     // Loguear el HTML del elemento problemático
                     console.log(`          HTML del elemento sin data-server: ${$(element).html()}`); // <-- LOG HTML elemento sin data-server
                }
            });
        } else {
             console.warn(`   [${id}] ADVERTENCIA: No se encontraron elementos con el selector "${serverSelector}" en el HTML recibido de ${targetUrl}.`);
             
        }

    } catch (error) {
        console.error(`   ❌ [${id}] ERROR en Stream Handler para URL ${targetUrl}:`);
        if (error.response) {
            console.error(`       -> Status Code: ${error.response.status}`);
            // Loguear un trozo de la respuesta de error si existe
             console.error(`       -> Respuesta de error (inicio): ${String(error.response.data).substring(0, 500)}`);
        } else if (error.request) {
             console.error(`       -> No se recibió respuesta del servidor (Error de red o timeout?).`);
        } else {
             console.error(`       -> Error durante la configuración/procesamiento de Axios: ${error.message}`);
        }
        return Promise.resolve({ streams: [] });
    }

    console.log(`<<< [${id}] Devolviendo ${streams.length} streams encontrados.`);
    return Promise.resolve({ streams });
});
// --- Iniciar Servidor ---
const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });

console.log(`\n✅ Addon ${manifest.name} (v${manifest.version}) iniciado.`);
console.log(`   >> Usando método RÁPIDO (Axios + Cheerio)`);
console.log(`   >> Handler 'meta' con selectores ¡FINALES! y episodios.`);
console.log(`   >> Handler 'stream' con soporte para Películas y Series/Animes/Doramas.`); // <-- Actualizado
console.log(`   >> Escuchando en http://127.0.0.1:${PORT}`);
console.log(`   >> Instala/Actualiza en Stremio usando: http://127.0.0.1:${PORT}/manifest.json`);

