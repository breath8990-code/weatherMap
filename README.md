# WeatherMap

## Student Name

Mohanad Jamal Mohammed Osman


## Description

WeatherMap is a simple single-page web application that shows the current weather for any place in the world. The user types a city name (or coordinates) and clicks **Get weather**. The app finds the location, fetches the current weather, moves the map to that spot, and shows the temperature, clouds, humidity, wind speed and a weather icon in a popup on the map. The popup also has a **Share** button. Everything runs asynchronously, so the page never reloads.

## Technologies

- HTML5
- CSS3
- Vanilla JavaScript (ES6+, Fetch API, async/await)
- Leaflet.js with OpenStreetMap (map)
- Nominatim API (geocoding: city name to latitude/longitude)
- OpenWeatherMap Current Weather API (weather data)
- Google Fonts

## How to Run

1. Download or clone the project:

   ```bash
   git clone https://github.com/breath8990-code/weatherMap
   cd WeatherMap
   ```

2. Start a simple local server from the project folder:

   ```bash
   python3 -m http.server 8000
   ```

3. Open `http://localhost:8000` in your browser.

4. Get a free API key from [OpenWeatherMap](https://openweathermap.org/), open the **Add weather API key** panel in the app, paste the key, and click **Use API key**.

5. Type a city (for example `Port Sudan`) and click **Get weather**.

**Live demo:** https://breath8990-code.github.io/weatherMap/
