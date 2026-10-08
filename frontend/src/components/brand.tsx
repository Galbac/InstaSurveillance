import Link from "next/link";

export default function Brand() {
  return (
    <Link href="/" className="brand" aria-label="InstaSurveillance, главная">
      <span className="brand-mark">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="24" height="24" rx="7.5" fill="currentColor" />
          <path
            d="M8.5 7.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM7.5 10a1 1 0 0 1 1-1h.25a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.5a1 1 0 0 1-1-1v-6Z"
            fill="#ffffff"
            opacity="0.95"
          />
          <path
            d="M16.5 10.2c-.3-.7-1-1.2-1.9-1.2h-.4c-.9 0-1.6.6-1.6 1.4 0 .9.8 1.3 1.6 1.6.9.3 2.1.8 2.1 2.2 0 1.5-1.2 2.6-2.7 2.6-.9 0-1.8-.4-2.2-1.2a.9.9 0 0 1 1.5-.9c.2.4.4.6.7.6.6 0 1-.4 1-1 0-.8-.8-1.2-1.6-1.5-.9-.3-2.1-.8-2.1-2.2 0-1.5 1.2-2.5 2.7-2.5 1.1 0 2.1.6 2.5 1.5a.9.9 0 0 1-1.3.7Z"
            fill="#ffffff"
            opacity="0.95"
          />
        </svg>
      </span>
      <span className="brand-name">InstaSurveillance</span>
    </Link>
  );
}

