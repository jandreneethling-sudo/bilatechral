const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('public/home', {
    title: 'Bilatechral Solutions',
    user: req.session.user || null
  });
});

router.get('/company-profile', (req, res) => {
  res.render('public/company-profile', {
    title: 'Company Profile',
    user: req.session.user || null
  });
});

router.get('/company-profile.pdf', (req, res) => {
  const doc = new PDFDocument({ margin: 40 });
  const logoPath = path.join(__dirname, '..', '..', 'artwork', 'Logo-Master.png');
  const heroImageOne = path.join(__dirname, '..', '..', 'public', 'images', 'hero', 'hero-1-900.jpg');
  const heroImageTwo = path.join(__dirname, '..', '..', 'public', 'images', 'hero', 'hero-2-900.jpg');
  const heroImageThree = path.join(__dirname, '..', '..', 'public', 'images', 'hero', 'hero-3-900.jpg');
  const weighbridgeImage = path.join(__dirname, '..', '..', 'artwork', 'ops_weighbridge.jpeg');

  const imageAssets = {
    operations: fs.existsSync(heroImageOne) ? heroImageOne : null,
    plant: fs.existsSync(heroImageTwo) ? heroImageTwo : null,
    stockpile: fs.existsSync(heroImageThree) ? heroImageThree : null,
    weighbridge: fs.existsSync(weighbridgeImage) ? weighbridgeImage : null
  };

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="bilatechral-company-profile.pdf"');
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  const ensureSpace = (requiredHeight) => {
    const limit = doc.page.height - doc.page.margins.bottom;
    if (doc.y + requiredHeight > limit) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  const drawSection = ({
    title,
    body,
    imagePath,
    imageAlign = 'right',
    imageStyle = {},
    sectionTone = 'light'
  }) => {
    const sectionImageWidth = imagePath ? imageStyle.width || 190 : 0;
    const sectionImageHeight = imagePath ? imageStyle.height || 122 : 0;
    const gutter = imagePath ? 14 : 0;
    const textWidth = contentWidth - sectionImageWidth - gutter;
    const estimatedTextHeight = doc.heightOfString(body, {
      width: textWidth,
      lineGap: 2
    });
    const minimumHeight = Math.max(sectionImageHeight, estimatedTextHeight + 30) + 18;

    ensureSpace(minimumHeight);

    const sectionTop = doc.y;
    const imageX = imageAlign === 'left' ? left : right - sectionImageWidth;
    const textX = imageAlign === 'left' ? left + sectionImageWidth + gutter : left;
    const panelTop = sectionTop - 7;
    const panelHeight = Math.max(sectionImageHeight, estimatedTextHeight + 30) + 14;

    doc
      .save()
      .roundedRect(left - 4, panelTop, contentWidth + 8, panelHeight, 10)
      .fill(sectionTone === 'blue' ? '#f2f6fd' : '#f8fafd')
      .restore();

    doc.fontSize(13).fillColor('#14233b').text(title, textX, sectionTop, {
      width: textWidth,
      underline: true
    });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#2b3a52').text(body, textX, doc.y, {
      width: textWidth,
      lineGap: 2
    });

    const textBottom = doc.y;

    if (imagePath) {
      if (imageStyle.mode === 'fit') {
        doc.image(imagePath, imageX, sectionTop + 2, {
          fit: [sectionImageWidth, sectionImageHeight],
          align: imageStyle.align || 'center',
          valign: imageStyle.valign || 'center'
        });
      } else {
        doc.image(imagePath, imageX, sectionTop + 2, {
          cover: [sectionImageWidth, sectionImageHeight],
          align: imageStyle.align || 'center',
          valign: imageStyle.valign || 'center'
        });
      }
    }

    doc.y = Math.max(textBottom, sectionTop + sectionImageHeight) + 16;
  };

  doc.rect(0, 0, pageWidth, 92).fill('#eef3fb');
  doc.fillColor('#14233b');

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 40, 30, { fit: [130, 50] });
    doc.fontSize(22).text('Bilatechral Solutions (PTY) Ltd', 185, 34);
    doc.fontSize(11).fillColor('#2b3a52').text('Company Profile', 185, 64);
    doc.fillColor('#14233b');
    doc.y = 108;
  } else {
    doc.fontSize(22).text('Bilatechral Solutions (PTY) Ltd', left, 36);
    doc.fontSize(11).fillColor('#2b3a52').text('Company Profile', left, 66);
    doc.fillColor('#14233b');
    doc.moveDown();
  }

  drawSection({
    title: 'Company Details',
    body: 'Name: Bilatechral Solutions (PTY) Ltd\nRegistration Number: 2023/910602/07\nManaging Director: Freddy Mkhabela\nAddress: Portion 5, Olifanstpoortje 319 KT, Extention 23, Steelpoort',
    imagePath: imageAssets.weighbridge,
    imageAlign: 'right',
    imageStyle: {
      width: 185,
      height: 136,
      align: 'center',
      valign: 'center'
    },
    sectionTone: 'blue'
  });

  drawSection({
    title: 'Who We Are',
    body: 'Bilatechral Solutions is positioned in Steelpoort as a practical exchange point for the chrome value chain. We support mines and traders with a dependable operating base where product can be received, stockpiled, tested and moved onward to market.',
    imagePath: imageAssets.operations,
    imageAlign: 'left',
    imageStyle: {
      width: 188,
      height: 126,
      align: 'left',
      valign: 'center'
    },
    sectionTone: 'light'
  });

  drawSection({
    title: 'Nature of Business',
    body: '- Chrome ore mining operations\n- Stockpiling facilities for testing and onward sale\n- On-site weighbridge support for transport requirements\n- Chrome ROM and concentrate flow facilitation\n- Service footprint: Steelpoort, Burgersfort and the Eastern Limpopo BIC',
    imagePath: imageAssets.plant,
    imageAlign: 'right',
    imageStyle: {
      width: 200,
      height: 112,
      mode: 'fit',
      align: 'center',
      valign: 'center'
    },
    sectionTone: 'blue'
  });

  drawSection({
    title: 'Commercial Role',
    body: 'In addition to operational handling, we maintain access to multiple offtake end-customers, helping mines and traders move product more efficiently from stockpile to sale.',
    imagePath: imageAssets.stockpile,
    imageAlign: 'left',
    imageStyle: {
      width: 190,
      height: 130,
      align: 'center',
      valign: 'top'
    },
    sectionTone: 'light'
  });

  drawSection({
    title: 'Customer Base',
    body: 'Our customer mix includes companies such as Global Nexus Trade, Umbono We Langa Mining, Energim, and other established mines and traders across the region.',
    imagePath: imageAssets.weighbridge,
    imageAlign: 'right',
    imageStyle: {
      width: 188,
      height: 126,
      align: 'right',
      valign: 'center'
    },
    sectionTone: 'blue'
  });

  const footerY = doc.page.height - doc.page.margins.bottom + 8;
  doc.fontSize(8).fillColor('#5d6878').text('Bilatechral Solutions (PTY) Ltd', left, footerY, {
    width: contentWidth,
    align: 'center'
  });

  doc.end();
});

module.exports = router;
