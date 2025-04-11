/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ["class"],
    content: [],
    theme: {
        fontFamily: {
            sans: ['Inter', 'sans-serif'],
        },
    	extend: {
    		fontSize: {
    			'responsive-xs': 'clamp(0.75rem, 1vw, 0.875rem)',
    			'responsive-sm': 'clamp(0.875rem, 1.2vw, 1rem)',
    			'responsive-base': 'clamp(1rem, 1.5vw, 1.125rem)',
    			'responsive-lg': 'clamp(1.125rem, 2vw, 1.25rem)',
    			'responsive-xl': 'clamp(1.25rem, 2.5vw, 1.5rem)',
    			'responsive-2xl': 'clamp(1.5rem, 3vw, 1.875rem)',
    			'responsive-3xl': 'clamp(1.875rem, 4vw, 2.25rem)',
    		},
    		borderRadius: {
    			lg: 'var(--radius)',
    			md: 'calc(var(--radius) - 2px)',
    			sm: 'calc(var(--radius) - 4px)'
    		},
    		colors: {
    			background: 'hsl(var(--background))',
    			foreground: 'hsl(var(--foreground))',
    			card: {
    				DEFAULT: 'hsl(var(--card))',
    				foreground: 'hsl(var(--card-foreground))'
    			},
    			popover: {
    				DEFAULT: 'hsl(var(--popover))',
    				foreground: 'hsl(var(--popover-foreground))'
    			},
    			primary: {
    				DEFAULT: 'hsl(var(--primary))',
    				foreground: 'hsl(var(--primary-foreground))'
    			},
    			secondary: {
    				DEFAULT: 'hsl(var(--secondary))',
    				foreground: 'hsl(var(--secondary-foreground))'
    			},
    			muted: {
    				DEFAULT: 'hsl(var(--muted))',
    				foreground: 'hsl(var(--muted-foreground))'
    			},
    			accent: {
    				DEFAULT: 'hsl(var(--accent))',
    				foreground: 'hsl(var(--accent-foreground))'
    			},
    			destructive: {
    				DEFAULT: 'hsl(var(--destructive))',
    				foreground: 'hsl(var(--destructive-foreground))'
    			},
    			border: 'hsl(var(--border))',
    			input: 'hsl(var(--input))',
    			ring: 'hsl(var(--ring))',
    			chart: {
    				'1': 'hsl(var(--chart-1))',
    				'2': 'hsl(var(--chart-2))',
    				'3': 'hsl(var(--chart-3))',
    				'4': 'hsl(var(--chart-4))',
    				'5': 'hsl(var(--chart-5))'
    			}
    		}
    	}
    },
    plugins: [require("tailwindcss-animate")],
  }