import Link from "next/link";
import { Orbit } from "lucide-react";
export default function Brand() {
  return (
    <Link href="/" className="brand" aria-label="InstaSurveillance, главная">
      <span className="brand-mark">
        <Orbit size={23} />
      </span>
      <span>
        insta<span className="brand-light">surveillance</span>
        <small>ТВОЙ КРУГ. ТВОЯ КАРТИНА.</small>
      </span>
    </Link>
  );
}
