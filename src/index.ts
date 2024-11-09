import express, { Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface Location {
  name: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  localTime?: string;
}

interface Condition {
  text: string;
  icon: string;
  code: number;
}

interface AirQuality {
  co: number;
  no2: number;
  o3: number;
  so2: number;
  pm2_5: number;
  pm10: number;
  'us-epa-index': number;
  'gb-defra-index': number;
}

interface CurrentWeather {
  tempC: number;
  tempF: number;
  condition: string;
  windKph: number;
  windDir: string;
  humidity: number;
  feelsLikeC: number;
  feelsLikeF: number;
  uv: number;
  airQuality: AirQuality;
}

interface HourlyForecast {
  time: string;
  tempC: number;
  condition: string;
  windKph: number;
  windDir: string;
  precipitation: number;
  humidity: number;
}

interface DailyForecast {
  date: string;
  maxTempC: number;
  minTempC: number;
  avgTempC: number;
  maxWindKph: number;
  totalPrecipMm: number;
  avgHumidity: number;
  condition: string;
  sunrise: string;
  sunset: string;
  hourly: HourlyForecast[];
}

interface WeatherResponse {
  location: Location;
  current: CurrentWeather;
}

interface ForecastResponse {
  location: Location;
  forecast: DailyForecast[];
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface ApiError {
  error: {
    message: string;
  };
}

class WeatherCache {
  private cache: Map<string, CacheEntry<any>>;
  private readonly cacheDuration: number;

  constructor(cacheDurationMs: number) {
    this.cache = new Map();
    this.cacheDuration = cacheDurationMs;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.timestamp < this.cacheDuration) {
      return entry.data as T;
    }
    if (entry) {
      this.cache.delete(key);
    }
    return null;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }
}

class WeatherAPI {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly cache: WeatherCache;

  constructor(apiKey: string, cacheDurationMs: number = 15 * 60 * 1000) {
    this.baseUrl = 'http://api.weatherapi.com/v1';
    this.apiKey = apiKey;
    this.cache = new WeatherCache(cacheDurationMs);
  }

  async getCurrentWeather(location: string): Promise<WeatherResponse> {
    const cacheKey = `current_${location}`;
    const cachedData = this.cache.get<WeatherResponse>(cacheKey);
    
    if (cachedData) {
      return cachedData;
    }

    const response = await axios.get(`${this.baseUrl}/current.json`, {
      params: {
        key: this.apiKey,
        q: location,
        aqi: 'yes'
      }
    });

    const weatherData: WeatherResponse = {
      location: {
        name: response.data.location.name,
        region: response.data.location.region,
        country: response.data.location.country,
        lat: response.data.location.lat,
        lon: response.data.location.lon,
        localTime: response.data.location.localtime
      },
      current: {
        tempC: response.data.current.temp_c,
        tempF: response.data.current.temp_f,
        condition: response.data.current.condition.text,
        windKph: response.data.current.wind_kph,
        windDir: response.data.current.wind_dir,
        humidity: response.data.current.humidity,
        feelsLikeC: response.data.current.feelslike_c,
        feelsLikeF: response.data.current.feelslike_f,
        uv: response.data.current.uv,
        airQuality: response.data.current.air_quality
      }
    };

    this.cache.set(cacheKey, weatherData);
    return weatherData;
  }

  async getForecast(location: string, days: number = 3): Promise<ForecastResponse> {
    const cacheKey = `forecast_${location}_${days}`;
    const cachedData = this.cache.get<ForecastResponse>(cacheKey);
    
    if (cachedData) {
      return cachedData;
    }

    const response = await axios.get(`${this.baseUrl}/forecast.json`, {
      params: {
        key: this.apiKey,
        q: location,
        days,
        aqi: 'yes'
      }
    });

    const forecastData: ForecastResponse = {
      location: {
        name: response.data.location.name,
        region: response.data.location.region,
        country: response.data.location.country,
        lat: response.data.location.lat,
        lon: response.data.location.lon
      },
      forecast: response.data.forecast.forecastday.map((day: any) => ({
        date: day.date,
        maxTempC: day.day.maxtemp_c,
        minTempC: day.day.mintemp_c,
        avgTempC: day.day.avgtemp_c,
        maxWindKph: day.day.maxwind_kph,
        totalPrecipMm: day.day.totalprecip_mm,
        avgHumidity: day.day.avghumidity,
        condition: day.day.condition.text,
        sunrise: day.astro.sunrise,
        sunset: day.astro.sunset,
        hourly: day.hour.map((hour: any) => ({
          time: hour.time,
          tempC: hour.temp_c,
          condition: hour.condition.text,
          windKph: hour.wind_kph,
          windDir: hour.wind_dir,
          precipitation: hour.precip_mm,
          humidity: hour.humidity
        }))
      }))
    };

    this.cache.set(cacheKey, forecastData);
    return forecastData;
  }

  async searchLocations(query: string): Promise<Location[]> {
    const response = await axios.get(`${this.baseUrl}/search.json`, {
      params: {
        key: this.apiKey,
        q: query
      }
    });

    return response.data.map((location: any) => ({
      name: location.name,
      region: location.region,
      country: location.country,
      lat: location.lat,
      lon: location.lon
    }));
  }
}

const app = express();
const port = process.env.PORT || 3000;
const weatherApi = new WeatherAPI(process.env.WEATHER_API_KEY || '');

app.use(express.json());

const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  if (axios.isAxiosError(err)) {
    const axiosError = err as AxiosError<ApiError>;
    res.status(axiosError.response?.status || 500).json({
      error: axiosError.response?.data?.error?.message || 'An error occurred with the weather service'
    });
  } else {
    res.status(500).json({ error: 'Internal server error' });
  }
};

app.get('/api/weather/current/:location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const weather = await weatherApi.getCurrentWeather(req.params.location);
    res.json(weather);
  } catch (error) {
    next(error);
  }
});

app.get('/api/weather/forecast/:location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = parseInt(req.query.days as string) || 3;
    const forecast = await weatherApi.getForecast(req.params.location, days);
    res.json(forecast);
  } catch (error) {
    next(error);
  }
});

app.get('/api/weather/search/:query', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locations = await weatherApi.searchLocations(req.params.query);
    res.json(locations);
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Weather API running on port ${port}`);
});