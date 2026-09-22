import io
import re
from typing import Dict, Optional, Tuple

import pdfminer.high_level
import pdfminer.layout
import pdfminer.pdfinterp
from pdfminer.converter import TextConverter
from pdfminer.pdfdocument import PDFDocument
from pdfminer.pdfinterp import PDFResourceManager
from pdfminer.pdfpage import PDFPage
from pdfminer.pdfparser import PDFParser

from src.backend.models.equipment import Equipment


class PDFProcessor:
    """
    Service for extracting structured data from equipment manuals.
    """

    def __init__(self):
        # Common patterns for extracting equipment specs from PDFs
        self.patterns = {
            "input_voltage": re.compile(
                r"input\s*voltage[:=\s]*([\d\.\s]+[vV][a-zA-Z%]*)", re.IGNORECASE
            ),
            "output_voltage": re.compile(
                r"output\s*voltage[:=\s]*([\d\.\s]+[vV][a-zA-Z%]*)", re.IGNORECASE
            ),
            "output_power": re.compile(
                r"output\s*power[:=\s]*([\d\.\s]+[wW])", re.IGNORECASE
            ),
            "frequency_response": re.compile(
                r"frequency\s*response[:=\s]*([\d\.\s]+[hH][zZ]\s*[-~]\s*[\d\.\s]+[hH][zZ])",
                re.IGNORECASE,
            ),
            "dimensions": re.compile(
                r"dimensions[:=\s]*([\d\.\s]+[xX][\d\.\s]+[xX][\d\.\s]+[mMmM])", re.IGNORECASE
            ),
            "weight": re.compile(
                r"weight[:=\s]*([\d\.\s]+[kKgGlLbBoOzZ])", re.IGNORECASE
            ),
            "signal_to_noise": re.compile(
                r"signal[-\s]*to[-\s]*noise[:=\s]*([\d\.\s]+[dBdB])", re.IGNORECASE
            ),
            "total_harmonic_distortion": re.compile(
                r"total\s*harmonic\s*distortion[:=\s]*([\d\.\s]+[%])", re.IGNORECASE
            ),
            "impedance": re.compile(
                r"impedance[:=\s]*([\d\.\s]+[ΩΩohms])", re.IGNORECASE
            ),
        }

    def extract_text_from_pdf(self, pdf_bytes: bytes) -> str:
        """
        Extract plain text from PDF bytes.

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            Extracted text as string.
        """
        try:
            return pdfminer.high_level.extract_text(io.BytesIO(pdf_bytes))
        except Exception as e:
            # Fallback to manual extraction if high-level fails
            return self._extract_text_manual(pdf_bytes)

    def _extract_text_manual(self, pdf_bytes: bytes) -> str:
        """
        Manual text extraction using pdfminer components.

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            Extracted text as string.
        """
        output_string = io.StringIO()
        with io.BytesIO(pdf_bytes) as in_file:
            parser = PDFParser(in_file)
            doc = PDFDocument(parser)
            rsrcmgr = PDFResourceManager()
            device = TextConverter(rsrcmgr, output_string)
            interpreter = pdfinterp.PDFPageInterpreter(rsrcmgr, device)
            for page in PDFPage.create_pages(doc):
                interpreter.process_page(page)
            device.close()
        return output_string.getvalue()

    def extract_features(self, text: str) -> Dict[str, Optional[str]]:
        """
        Extract equipment features from text using regex patterns.

        Args:
            text: Input text to search.

        Returns:
            Dictionary of extracted features.
        """
        features = {}
        for key, pattern in self.patterns.items():
            match = pattern.search(text)
            if match:
                features[key] = match.group(1).strip()
            else:
                features[key] = None
        return features

    def process_equipment_manual(
        self, pdf_bytes: bytes, equipment: Equipment
    ) -> Equipment:
        """
        Process an equipment manual PDF and update equipment with extracted specs.

        Args:
            pdf_bytes: PDF file content.
            equipment: Equipment object to update.

        Returns:
            Updated equipment with extracted specifications.
        """
        text = self.extract_text_from_pdf(pdf_bytes)
        features = self.extract_features(text)

        # Update equipment specifications with non-None features
        for key, value in features.items():
            if value is not None:
                equipment.specifications[key] = value

        # Attempt to extract model number if not present
        if not equipment.model:
            model_patterns = [
                re.compile(r"model\s*[:\-]?\s*([a-zA-Z0-9\-\s]+)", re.IGNORECASE),
                re.compile(r"([a-zA-Z]{2,}\d+[a-zA-Z0-9\-\s]*)", re.IGNORECASE),
            ]
            for pattern in model_patterns:
                match = pattern.search(text)
                if match:
                    equipment.model = match.group(1).strip()
                    break

        return equipment