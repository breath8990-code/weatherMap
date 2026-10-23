(() => {
  'use strict';

  const KHARTOUM = { lat: 15.5007, lon: 32.5599, name: 'Khartoum, Sudan' };
  const FAVORITES_KEY = 'weathermap:favorites:v1';
  const MAX_FAVORITES = 8;
  const REQUEST_TIMEOUT_MS = 20_000;

  const form = document.querySelector('#searchForm');
  const locationInput = document.querySelector('#locationInput');
  const apiKeyPanel = document.querySelector('#apiKeyPanel');
  const apiKeyInput = document.querySelector('#apiKeyInput');
  const keyStatus = document.querySelector('#keyStatus');
  const keyMessage = document.querySelector('#keyMessage');
  const loadingIndicator = document.querySelector('#loadingIndicator');
  const loadingLabel = document.querySelector('#loadingLabel');
  const statusMessage = document.querySelector('#statusMessage');
  const favoritesList = document.querySelector('#favoritesList');
  const addFavoriteButton = document.querySelector('#addFavoriteButton');
  const mapLocationBadge = document.querySelector('#mapLocationBadge');

  let apiKey = '';
  let activeController = null;
  let requestSequence = 0;
  let map = null;
  let weatherMarker = null;
  let selectedWeather = null;
  let favorites = loadFavorites();

  function setNotice(message, type = 'error') {
    statusMessage.textContent = message;
    statusMessage.className = type === 'success' ? 'notice notice--success' : 'notice';
    statusMessage.hidden = false;
  }

  function clearNotice() {
    statusMessage.textContent = '';
    statusMessage.hidden = true;
    statusMessage.className = 'notice';
  }

  function setLoading(isLoading, label = 'Finding your place…') {
    loadingIndicator.hidden = !isLoading;
    loadingLabel.textContent = label;
    form.setAttribute('aria-busy', String(isLoading));
  }

  function safeText(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
  }

  function initializeMap() {
    const mapElement = document.querySelector('#map');
    if (!window.L) {
      mapElement.setAttribute('aria-label', 'Map unavailable. Check your connection and reload the page.');
      setNotice('The map library could not be loaded. Check your connection and reload the page.');
      return;
    }

    map = window.L.map(mapElement, {
      zoomControl: false,
      scrollWheelZoom: false,
      preferCanvas: true
    }).setView([KHARTOUM.lat, KHARTOUM.lon], 6);

    window.L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);
    window.L.control.zoom({ position: 'bottomright' }).addTo(map);

    weatherMarker = window.L.marker([KHARTOUM.lat, KHARTOUM.lon], {
      icon: makeMarkerIcon(true),
      title: KHARTOUM.name,
      alt: KHARTOUM.name
    }).addTo(map);

    window.setTimeout(() => map.invalidateSize(), 150);
    window.addEventListener('resize', () => map.invalidateSize());
    map.on('popupopen', attachShareHandler);
  }

  function makeMarkerIcon(isCurrent = false) {
    return window.L.divIcon({
      className: 'weather-map-pin-shell',
      html: `<span class="weather-map-pin${isCurrent ? ' weather-map-pin--current' : ''}" aria-hidden="true"></span>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
  }

  async function fetchJson(url, signal, serviceName) {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The request took too long. Please try again.');
      }
      throw new Error(`Could not reach ${serviceName}. Check your internet connection and try again.`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`${serviceName} returned an unreadable response. Please try again later.`);
    }

    if (!response.ok) {
      if (serviceName === 'OpenWeatherMap' && response.status === 401) {
        throw new Error('OpenWeatherMap did not accept this API key. Check the key and try again.');
      }
      if (serviceName === 'OpenWeatherMap' && response.status === 404) {
        throw new Error('Weather data could not be found for this location. Try a nearby city.');
      }
      if (response.status === 429) {
        throw new Error(`${serviceName} is receiving too many requests. Wait a moment, then try again.`);
      }
      throw new Error(`${serviceName} could not complete the request (${response.status}). Please try again.`);
    }
    return payload;
  }

  async function geocodePlace(query, signal) {
    const params = new URLSearchParams({
      format: 'jsonv2',
      q: query,
      limit: '1',
      addressdetails: '1'
    });
    const results = await fetchJson(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      signal,
      'OpenStreetMap search'
    );

    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`We couldn't find “${query}”. Check the spelling or try a nearby city.`);
    }

    const result = results[0];
    const lat = Number(result.lat);
    const lon = Number(result.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error('The location search returned invalid coordinates. Try another search.');
    }

    const address = result.address || {};
    const locality = address.city || address.town || address.village || address.municipality || address.county || result.name;
    const name = String(locality || String(result.display_name || query).split(',')[0]).trim();
    const country = String(address.country || '').trim();
    return { lat, lon, name, country, query, displayName: result.display_name || name };
  }

  function parseCoordinates(query) {
    const normalized = query.trim().replace(/−/g, '-').toUpperCase();
    const labeledLatitude = normalized.match(/(?:LATITUDE|LAT)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)(?:\s*°?\s*([NS]))?/);
    const labeledLongitude = normalized.match(/(?:LONGITUDE|LONG|LON|LNG)\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)(?:\s*°?\s*([EW]))?/);
    if (labeledLatitude && labeledLongitude) {
      const latitudeDirection = labeledLatitude[2];
      const longitudeDirection = labeledLongitude[2];
      const lat = latitudeDirection ? Math.abs(Number(labeledLatitude[1])) * (latitudeDirection === 'S' ? -1 : 1) : Number(labeledLatitude[1]);
      const lon = longitudeDirection ? Math.abs(Number(labeledLongitude[1])) * (longitudeDirection === 'W' ? -1 : 1) : Number(labeledLongitude[1]);
      return { lat, lon, valid: Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 };
    }
    const coordinateText = normalized.replace(/LATITUDE|LONGITUDE|LAT|LON|LNG|LONG/g, '');
    const allowed = coordinateText.replace(/[0-9+\-.,;|/:=\s()°ºNSEW]/g, '');
    if (allowed) return null;
    const values = coordinateText.match(/[+-]?\d+(?:\.\d+)?/g);
    if (!values || values.length !== 2) return null;
    const directions = coordinateText.match(/[NSEW]/g) || [];
    let first = Number(values[0]);
    let second = Number(values[1]);
    let lat;
    let lon;
    if (directions.length === 2) {
      const firstIsLatitude = /[NS]/.test(directions[0]);
      const secondIsLatitude = /[NS]/.test(directions[1]);
      if (firstIsLatitude === secondIsLatitude) return null;
      const latitudeValue = firstIsLatitude ? first : second;
      const longitudeValue = firstIsLatitude ? second : first;
      const latitudeDirection = firstIsLatitude ? directions[0] : directions[1];
      const longitudeDirection = firstIsLatitude ? directions[1] : directions[0];
      lat = Math.abs(latitudeValue) * (latitudeDirection === 'S' ? -1 : 1);
      lon = Math.abs(longitudeValue) * (longitudeDirection === 'W' ? -1 : 1);
    } else {
      lat = first;
      lon = second;
      if (Math.abs(lat) > 90 && Math.abs(lon) <= 90 && Math.abs(lat) <= 180) [lat, lon] = [lon, lat];
    }
    return { lat, lon, valid: Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 };
  }

  function makeCoordinatePlace(query, coordinates) {
    return {
      lat: coordinates.lat,
      lon: coordinates.lon,
      name: 'Selected location',
      country: '',
      query,
      displayName: query
    };
  }

  async function fetchWeather(place, signal) {
    const params = new URLSearchParams({
      lat: String(place.lat),
      lon: String(place.lon),
      appid: apiKey,
      units: 'metric'
    });
    return fetchJson(
      `https://api.openweathermap.org/data/2.5/weather?${params.toString()}`,
      signal,
      'OpenWeatherMap'
    );
  }

  function formatWind(speed) {
    const value = Number(speed);
    return Number.isFinite(value) ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} m/s` : '—';
  }

  function formatTemperature(value) {
    const temperature = Number(value);
    return Number.isFinite(temperature) ? `${Math.round(temperature)}°` : '—';
  }

  function formatCoordinate(value, positiveDirection, negativeDirection) {
    const coordinate = Number(value);
    const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 }).format(Math.abs(coordinate));
    return `${formatted}° ${coordinate >= 0 ? positiveDirection : negativeDirection}`;
  }

  function formatCoordinates(place) {
    return `${formatCoordinate(place.lat, 'N', 'S')}, ${formatCoordinate(place.lon, 'E', 'W')}`;
  }

  function buildWeatherPopup(place, weather) {
    const current = weather.weather && weather.weather[0] ? weather.weather[0] : {};
    const iconCode = /^[0-9]{2}[dn]$/.test(String(current.icon || '')) ? String(current.icon) : '02d';
    const iconFiles = {
      '01d': 'sunny.svg',
      '01n': 'clear-night.svg',
      '02d': 'partly-cloudy.svg',
      '02n': 'partly-cloudy-night.svg',
      '03d': 'cloudy.svg',
      '03n': 'cloudy.svg',
      '04d': 'overcast.svg',
      '04n': 'overcast.svg',
      '09d': 'rain.svg',
      '09n': 'rain.svg',
      '10d': 'rain.svg',
      '10n': 'rain.svg',
      '11d': 'thunderstorm.svg',
      '11n': 'thunderstorm.svg',
      '13d': 'snow.svg',
      '13n': 'snow.svg',
      '50d': 'mist.svg',
      '50n': 'mist.svg'
    };
    const iconUrl = `assets/weather-icons/${iconFiles[iconCode] || 'cloudy.svg'}`;
    const locationLabel = place.country ? `${place.name}, ${place.country}` : place.name;
    const sharePage = new URL(window.location.href);
    sharePage.searchParams.set('place', place.query);
    const facebookShare = new URL('https://www.facebook.com/sharer/sharer.php');
    facebookShare.searchParams.set('u', sharePage.toString());
    facebookShare.searchParams.set('quote', makeShareText(place, weather));
    const condition = safeText(current.description || current.main || 'Current conditions');
    const temp = formatTemperature(weather.main && weather.main.temp);
    const tempValue = temp.endsWith('°') ? temp.slice(0, -1) : temp;
    const coordinates = formatCoordinates(place);
    const clouds = Number.isFinite(Number(weather.clouds && weather.clouds.all)) ? `${Number(weather.clouds.all)}%` : '—';
    const humidity = Number.isFinite(Number(weather.main && weather.main.humidity)) ? `${Number(weather.main.humidity)}%` : '—';
    const wind = formatWind(weather.wind && weather.wind.speed);

    return `<article class="weather-card">
      <header class="weather-card__header">
        <div class="weather-card__location">
          <p class="weather-card__eyebrow"><span class="weather-card__live-dot"></span> LIVE WEATHER</p>
          <h3 class="weather-card__place">${safeText(place.name)}</h3>
          <p class="weather-card__country">${safeText(place.country || 'Selected location')}</p>
          <p class="weather-card__coordinates">${coordinates}</p>
        </div>
        <img class="weather-card__icon" src="${iconUrl}" alt="${condition}" width="68" height="68">
      </header>
      <section class="weather-card__summary" aria-label="Current temperature and condition">
        <div class="weather-card__temperature-block">
          <span class="weather-card__temp">${tempValue}</span>
          <span class="weather-card__units">°C<br><span>FEELS ${formatTemperature(weather.main && weather.main.feels_like)}</span></span>
        </div>
        <p class="weather-card__condition">${condition}</p>
      </section>
      <div class="weather-card__metrics">
        <div class="weather-card__metric"><span class="weather-card__metric-label">CLOUDS</span><strong class="weather-card__metric-value">${clouds}</strong></div>
        <div class="weather-card__metric"><span class="weather-card__metric-label">HUMIDITY</span><strong class="weather-card__metric-value">${humidity}</strong></div>
        <div class="weather-card__metric"><span class="weather-card__metric-label">WIND</span><strong class="weather-card__metric-value">${wind}</strong></div>
      </div>
      <div class="weather-card__share-actions">
        <button class="popup-share" type="button" data-action="share-weather" aria-label="Share weather for ${safeText(locationLabel)}">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="15" cy="4" r="2.2"></circle><circle cx="5" cy="10" r="2.2"></circle><circle cx="15" cy="16" r="2.2"></circle><path d="m7 9 5.8-3.7M7 11l5.8 3.7"></path></svg>
          <span>Share</span>
        </button>
        <a class="popup-facebook-share" href="${safeText(facebookShare.toString())}" target="_blank" rel="noopener noreferrer">
          <span class="popup-facebook-share__mark" aria-hidden="true">f</span> Facebook
        </a>
      </div>
    </article>`;
  }

  function attachShareHandler(event) {
    const shareButton = event.popup.getElement().querySelector('[data-action="share-weather"]');
    if (!shareButton) return;
    shareButton.addEventListener('click', shareWeather);
  }

  function makeShareText(place, weather) {
    const condition = weather.weather && weather.weather[0] ? weather.weather[0].description : 'current conditions';
    const temperature = formatTemperature(weather.main && weather.main.temp);
    const clouds = Number.isFinite(Number(weather.clouds && weather.clouds.all)) ? `${Number(weather.clouds.all)}%` : '—';
    const humidity = Number.isFinite(Number(weather.main && weather.main.humidity)) ? `${Number(weather.main.humidity)}%` : '—';
    const wind = formatWind(weather.wind && weather.wind.speed);
    const location = place.country ? `${place.name}, ${place.country}` : place.name;
    return `Weather in ${location}: ${temperature}, ${condition}. Clouds ${clouds}, humidity ${humidity}, wind ${wind}.`;
  }

  async function shareWeather() {
    if (!selectedWeather) return;
    const { place, weather } = selectedWeather;
    const text = makeShareText(place, weather);
    const sharePage = new URL(window.location.href);
    sharePage.searchParams.set('place', place.query);
    const shareData = { title: `Weather in ${place.name}`, text, url: sharePage.toString() };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        setNotice('Weather shared successfully.', 'success');
        return;
      }
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.');
      }
      await navigator.clipboard.writeText(text);
      setNotice('Weather summary copied to your clipboard.', 'success');
    } catch (error) {
      if (error.name === 'AbortError') return;
      setNotice(error.message || 'Could not share the weather summary.');
    }
  }

  async function searchWeather(rawQuery) {
    const query = String(rawQuery || '').trim();
    if (!query) {
      setNotice('Enter a city or place to search.');
      locationInput.focus();
      return;
    }
    const coordinates = parseCoordinates(query);
    if (coordinates && !coordinates.valid) {
      setNotice('Enter latitude from −90 to 90 and longitude from −180 to 180.');
      locationInput.focus();
      return;
    }
    if (!apiKey) {
      apiKeyPanel.open = true;
      setNotice('Add your OpenWeatherMap API key in the panel above to request a forecast.');
      apiKeyInput.focus();
      return;
    }

    requestSequence += 1;
    const sequence = requestSequence;
    if (activeController) activeController.abort();
    const controller = new AbortController();
    activeController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    clearNotice();
    setLoading(true, `Finding ${query}…`);
    addFavoriteButton.disabled = true;

    try {
      const place = coordinates
        ? makeCoordinatePlace(query, coordinates)
        : await geocodePlace(query, controller.signal);
      if (sequence !== requestSequence) return;
      setLoading(true, `Checking current weather in ${place.name}…`);
      const weather = await fetchWeather(place, controller.signal);
      if (sequence !== requestSequence) return;
      if (!weather || !weather.main || !Array.isArray(weather.weather)) {
        throw new Error('The weather service returned incomplete data. Please try again later.');
      }
      if (coordinates) {
        const weatherName = String(weather.name || '').trim();
        const countryCode = String(weather.sys && weather.sys.country || '').trim();
        let countryName = countryCode;
        if (countryCode) {
          try {
            countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) || countryCode;
          } catch (error) {
            countryName = countryCode;
          }
        }
        place.name = weatherName || `Location ${formatCoordinates(place)}`;
        place.country = countryName;
        place.displayName = countryName ? `${place.name}, ${countryName}` : place.name;
      }
      selectedWeather = { place, weather };
      renderWeather(place, weather);
      addFavoriteButton.disabled = false;
    } catch (error) {
      if (sequence !== requestSequence) return;
      setNotice(error.message || 'Something went wrong while finding the weather. Please try again.');
    } finally {
      window.clearTimeout(timeoutId);
      if (sequence === requestSequence) {
        setLoading(false);
        activeController = null;
      }
    }
  }

  function renderWeather(place, weather) {
    if (!map || !window.L) {
      setNotice('The map is unavailable, but the location and weather were found. Reload to restore the map.');
      return;
    }
    if (weatherMarker) map.removeLayer(weatherMarker);
    const marker = window.L.marker([place.lat, place.lon], {
      icon: makeMarkerIcon(),
      title: place.name,
      alt: place.name
    }).addTo(map);
    weatherMarker = marker;

    marker.bindPopup(buildWeatherPopup(place, weather), {
      closeButton: true,
      maxWidth: 340,
      minWidth: 292,
      autoPan: true,
      autoPanPadding: [24, 24],
      className: 'weather-popup'
    });

    map.stop();
    const target = window.L.latLng(place.lat, place.lon);
    const targetZoom = Math.max(map.getZoom(), 10);
    const needsMove = map.getZoom() !== targetZoom || map.getCenter().distanceTo(target) > 1;
    if (needsMove) {
      map.once('moveend', () => {
        if (weatherMarker === marker) marker.openPopup();
      });
      map.flyTo(target, targetZoom, {
        animate: true,
        duration: 1.15
      });
    } else {
      marker.openPopup();
    }

    const label = place.country ? `${place.name}, ${place.country}` : place.name;
    mapLocationBadge.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'map-location__dot';
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    mapLocationBadge.append(dot, text);
    document.querySelector('#map').setAttribute('aria-label', `Interactive weather map centered on ${label}`);
    clearNotice();
  }

  function loadFavorites() {
    try {
      const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.query === 'string' && typeof item.name === 'string')
        .map((item) => ({ query: item.query.slice(0, 120), name: item.name.slice(0, 100) }))
        .slice(0, MAX_FAVORITES);
    } catch {
      return [];
    }
  }

  function persistFavorites() {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      return true;
    } catch {
      setNotice('Your browser blocked local storage, so this favorite could not be saved.');
      return false;
    }
  }

  function renderFavorites() {
    favoritesList.replaceChildren();
    if (favorites.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'favorites__empty';
      empty.textContent = 'Your saved places will appear here.';
      favoritesList.append(empty);
      return;
    }

    favorites.forEach((favorite, index) => {
      const item = document.createElement('div');
      item.className = 'favorite-item';

      const searchButton = document.createElement('button');
      searchButton.className = 'favorite-pill';
      searchButton.type = 'button';
      searchButton.dataset.action = 'search-favorite';
      searchButton.dataset.index = String(index);
      searchButton.setAttribute('aria-label', `Get weather for ${favorite.name}`);
      const name = document.createElement('span');
      name.textContent = favorite.name;
      const arrow = document.createElement('span');
      arrow.className = 'favorite-pill__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      searchButton.append(name, arrow);

      const removeButton = document.createElement('button');
      removeButton.className = 'favorite-remove';
      removeButton.type = 'button';
      removeButton.dataset.action = 'remove-favorite';
      removeButton.dataset.index = String(index);
      removeButton.setAttribute('aria-label', `Remove ${favorite.name} from saved places`);
      removeButton.textContent = '×';

      item.append(searchButton, removeButton);
      favoritesList.append(item);
    });
  }

  function saveCurrentFavorite() {
    if (!selectedWeather) return;
    const { place } = selectedWeather;
    const exists = favorites.some((item) => item.query.toLowerCase() === place.query.toLowerCase());
    if (exists) {
      setNotice(`${place.name} is already in your saved places.`, 'success');
      return;
    }
    if (favorites.length >= MAX_FAVORITES) {
      setNotice(`You can save up to ${MAX_FAVORITES} places. Remove one to add another.`);
      return;
    }
    favorites.unshift({ query: place.query, name: place.name });
    if (persistFavorites()) {
      renderFavorites();
      setNotice(`${place.name} was saved to your places.`, 'success');
    } else {
      favorites.shift();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (apiKey) {
      document.querySelector('.map-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    searchWeather(locationInput.value);
  });

  document.querySelector('#activateKeyButton').addEventListener('click', () => {
    const enteredKey = apiKeyInput.value.trim();
    if (!enteredKey) {
      keyMessage.textContent = 'Paste your key above, then select this button.';
      apiKeyInput.focus();
      return;
    }
    apiKey = enteredKey;
    keyStatus.textContent = 'Key ready in this tab';
    keyMessage.textContent = 'Key ready. It will be cleared when this tab is refreshed or closed.';
  });

  apiKeyInput.addEventListener('input', () => {
    apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      keyStatus.textContent = 'Key entered';
      keyMessage.textContent = 'Key held in this tab only. It will not be saved to browser storage.';
    } else {
      keyStatus.textContent = 'Required for forecasts';
      keyMessage.textContent = '';
    }
  });

  document.querySelector('#toggleKeyVisibility').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const reveal = apiKeyInput.type === 'password';
    apiKeyInput.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? 'Hide' : 'Show';
    button.setAttribute('aria-label', reveal ? 'Hide API key' : 'Show API key');
  });

  document.querySelector('#clearKeyButton').addEventListener('click', () => {
    apiKey = '';
    apiKeyInput.value = '';
    keyStatus.textContent = 'Required for forecasts';
    keyMessage.textContent = 'Key cleared from this tab.';
  });

  addFavoriteButton.addEventListener('click', saveCurrentFavorite);

  favoritesList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const favorite = favorites[index];
    if (!favorite) return;

    if (button.dataset.action === 'search-favorite') {
      locationInput.value = favorite.query;
      searchWeather(favorite.query);
      locationInput.focus();
      return;
    }

    if (button.dataset.action === 'remove-favorite') {
      favorites.splice(index, 1);
      if (persistFavorites()) {
        renderFavorites();
        setNotice(`${favorite.name} was removed from your saved places.`, 'success');
      } else {
        favorites.splice(index, 0, favorite);
      }
    }
  });

  initializeMap();
  renderFavorites();
  const sharedPlace = new URLSearchParams(window.location.search).get('place');
  if (sharedPlace && sharedPlace.length <= 120) locationInput.value = sharedPlace;
})();
