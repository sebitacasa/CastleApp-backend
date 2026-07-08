declare module 'country-language' {
    interface Language {
        iso639_1?: string;
        iso639_2?: string;
        name?: string[];
        countries?: { alpha2: string }[];
    }
    interface Country {
        languages?: Language[];
    }
    const cl: {
        getCountry(code: string | null | undefined): Country | undefined;
        getCountryLanguages(code: string, cb: (err: unknown, languages: Language[]) => void): void;
    };
    export default cl;
}
