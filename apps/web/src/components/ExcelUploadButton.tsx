import { Link } from 'react-router-dom';
import excelIcon from '@assets/img/excel.png';

interface Props {
  to: string;
}

export function ExcelUploadButton({ to }: Props) {
  return (
    <Link
      to={to}
      className="btn secondary"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
    >
      <img src={excelIcon} alt="" width={18} height={18} style={{ display: 'block' }} />
      Cargar Excel/CSV
    </Link>
  );
}
